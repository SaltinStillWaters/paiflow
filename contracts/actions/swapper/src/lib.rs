#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

#[contracttype]
pub enum Key {
    Admin,
    AssetIn,
    AssetOut,
    AmmRouter,
    SlippageBps,
    NextSteps,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    InsufficientOutput = 4,
    BadSlippage = 5,
    SwapFailed = 6,
}

const VERSION: u32 = 2;
const TOTAL_BPS: u32 = 10_000;
const SWAP_DEADLINE_SECONDS: u64 = 300;

#[contract]
pub struct Swapper;

#[contractimpl]
impl Swapper {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset_in: Address,
        asset_out: Address,
        amm_router: Address,
        slippage_bps: u32,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if slippage_bps == 0 || slippage_bps >= TOTAL_BPS {
            panic_with_error!(&env, Error::BadSlippage);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::AssetIn, &asset_in);
        env.storage().instance().set(&Key::AssetOut, &asset_out);
        env.storage().instance().set(&Key::AmmRouter, &amm_router);
        env.storage().instance().set(&Key::SlippageBps, &slippage_bps);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        let asset_in: Address = env.storage().instance().get(&Key::AssetIn).unwrap();
        if asset != asset_in {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let asset_out: Address = env.storage().instance().get(&Key::AssetOut).unwrap();
        let amm_router: Address = env.storage().instance().get(&Key::AmmRouter).unwrap();
        let slippage_bps: u32 = env.storage().instance().get(&Key::SlippageBps).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        let path = vec![&env, asset_in.clone(), asset_out.clone()];

        // Query the router for the expected output amount.
        let contract_addr = env.current_contract_address();
        let amounts = env.invoke_contract::<Vec<i128>>(
            &amm_router,
            &Symbol::new(&env, "router_get_amounts_out"),
            vec![&env, amount.into_val(&env), path.into_val(&env)],
        );

        let expected_out = amounts.last().unwrap_or(0);
        if expected_out <= 0 {
            panic_with_error!(&env, Error::InsufficientOutput);
        }

        // Apply slippage tolerance.
        let amount_out_min = expected_out
            .checked_mul((TOTAL_BPS - slippage_bps) as i128)
            .and_then(|v| v.checked_div(TOTAL_BPS as i128))
            .unwrap_or(0);
        if amount_out_min <= 0 {
            panic_with_error!(&env, Error::InsufficientOutput);
        }

        let deadline = env.ledger().timestamp() + SWAP_DEADLINE_SECONDS;

        // Execute the swap via the AMM router.
        let swap_result = env.try_invoke_contract::<Vec<i128>, soroban_sdk::Error>(
            &amm_router,
            &Symbol::new(&env, "swap_exact_tokens_for_tokens"),
            vec![
                &env,
                amount.into_val(&env),
                amount_out_min.into_val(&env),
                path.into_val(&env),
                contract_addr.into_val(&env),
                deadline.into_val(&env),
            ],
        );

        match swap_result {
            Ok(Ok(_)) => {}
            _ => panic_with_error!(&env, Error::SwapFailed),
        }

        // Forward the received asset_out to the next step(s).
        let out_client = token::Client::new(&env, &asset_out);
        let contract_balance = out_client.balance(&contract_addr);
        if contract_balance <= 0 {
            panic_with_error!(&env, Error::InsufficientOutput);
        }

        for step in next_steps.iter() {
            out_client.transfer(&contract_addr, &step.address, &contract_balance);
            invoke_receive_and_forward(
                &env,
                &step.address,
                &contract_addr,
                &asset_out,
                &contract_balance,
            );
        }

        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("swap"), asset_in, asset_out),
            (amount, contract_balance),
        );
    }

    pub fn asset_in(env: Env) -> Address {
        env.storage().instance().get(&Key::AssetIn).unwrap()
    }

    pub fn asset_out(env: Env) -> Address {
        env.storage().instance().get(&Key::AssetOut).unwrap()
    }

    pub fn amm_router(env: Env) -> Address {
        env.storage().instance().get(&Key::AmmRouter).unwrap()
    }

    pub fn slippage_bps(env: Env) -> u32 {
        env.storage().instance().get(&Key::SlippageBps).unwrap()
    }
}

fn invoke_receive_and_forward(
    env: &Env,
    target: &Address,
    from: &Address,
    asset: &Address,
    amount: &i128,
) {
    let func = soroban_sdk::Symbol::new(env, "receive_and_forward");
    let empty_steps = Vec::<WorkflowTarget>::new(env);
    env.invoke_contract::<()>(
        target,
        &func,
        vec![
            env,
            from.into_val(env),
            asset.into_val(env),
            amount.into_val(env),
            empty_steps.into_val(env),
        ],
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    /// Mock AMM router for unit tests.
    #[contract]
    pub struct MockRouter;

    #[contractimpl]
    impl MockRouter {
        pub fn __constructor(_env: Env) {}

        pub fn router_get_amounts_out(_env: Env, amount_in: i128, _path: Vec<Address>) -> Vec<i128> {
            // Simulate a 5% fee / price impact.
            let amount_out = amount_in * 95 / 100;
            vec![&_env, amount_in, amount_out]
        }

        pub fn swap_exact_tokens_for_tokens(
            env: Env,
            amount_in: i128,
            _amount_out_min: i128,
            path: Vec<Address>,
            to: Address,
            _deadline: u64,
        ) -> Vec<i128> {
            let token_in = path.get(0).unwrap();
            let token_out = path.get(1).unwrap();
            let caller = env.current_contract_address();

            // Simulate what Soroswap Router does: pull input tokens from `to` into the router.
            token::Client::new(&env, &token_in).transfer(&to, &caller, &amount_in);

            // Simulate swap: transfer token_out from router to `to`.
            let amount_out = amount_in * 95 / 100;
            token::Client::new(&env, &token_out).transfer(&caller, &to, &amount_out);

            vec![&env, amount_in, amount_out]
        }
    }

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn receive_and_forward(
            _env: Env,
            _from: Address,
            _asset: Address,
            _amount: i128,
            _next_steps: Vec<WorkflowTarget>,
        ) {
        }
    }

    #[test]
    fn swaps_via_amm_router() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let asset_in = env.register_stellar_asset_contract_v2(admin.clone());
        let asset_out = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_in = token::StellarAssetClient::new(&env, &asset_in.address());
        let sac_out = token::StellarAssetClient::new(&env, &asset_out.address());
        let tok_out = token::TokenClient::new(&env, &asset_out.address());

        let predecessor = Address::generate(&env);
        sac_in.mint(&predecessor, &1_000);

        // Pre-fund the mock router with asset_out so it can fulfill swaps.
        let router_id = env.register(MockRouter, ());
        sac_out.mint(&router_id, &1_000);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Swapper,
            (
                admin.clone(),
                asset_in.address(),
                asset_out.address(),
                router_id.clone(),
                100_u32, // 1% slippage
                next_steps,
            ),
        );
        let client = SwapperClient::new(&env, &contract_id);

        // Predecessor sends asset_in to swapper contract.
        let tok_in = token::TokenClient::new(&env, &asset_in.address());
        tok_in.transfer(&predecessor, &contract_id, &1_000);

        client.receive_and_forward(&predecessor, &asset_in.address(), &1_000, &vec![&env]);

        // 1000 * 95 / 100 = 950 (mock router simulates 5% fee)
        assert_eq!(tok_out.balance(&next), 950);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn swap_failed_when_router_has_no_liquidity() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let asset_in = env.register_stellar_asset_contract_v2(admin.clone());
        let asset_out = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_in = token::StellarAssetClient::new(&env, &asset_in.address());

        let predecessor = Address::generate(&env);
        sac_in.mint(&predecessor, &1_000);

        let router_id = env.register(MockRouter, ());

        let contract_id = env.register(
            Swapper,
            (
                admin,
                asset_in.address(),
                asset_out.address(),
                router_id,
                100_u32,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SwapperClient::new(&env, &contract_id);

        let tok_in = token::TokenClient::new(&env, &asset_in.address());
        tok_in.transfer(&predecessor, &contract_id, &1_000);

        // Mock router has no asset_out, so swap will produce 0 output and panic.
        client.receive_and_forward(&predecessor, &asset_in.address(), &1_000, &vec![&env]);
    }
}
