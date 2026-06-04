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
#[derive(Clone)]
pub struct VaultPosition {
    pub total_deposited: i128,
    pub total_shares: i128,
}

#[contracttype]
pub enum Key {
    Admin,
    Asset,
    Vault,
    NextSteps,
    Position,
    ParentNode,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    NothingToHarvest = 4,
    VaultCallFailed = 5,
}

const VERSION: u32 = 2;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Yield;

#[contractimpl]
impl Yield {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        vault: Address,
        next_steps: Vec<WorkflowTarget>,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Vault, &vault);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(
            &Key::Position,
            &VaultPosition {
                total_deposited: 0,
                total_shares: 0,
            },
        );
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let vault: Address = env.storage().instance().get(&Key::Vault).unwrap();

        // Transfer tokens to vault, then call deposit to get shares credited.
        token::Client::new(&env, &asset).transfer(&env.current_contract_address(), &vault, &amount);

        let shares_received = deposit_to_vault(&env, &vault, amount);

        let mut pos: VaultPosition = env.storage().instance().get(&Key::Position).unwrap();
        pos.total_deposited = pos
            .total_deposited
            .checked_add(amount)
            .unwrap_or(pos.total_deposited);
        pos.total_shares = pos
            .total_shares
            .checked_add(shares_received)
            .unwrap_or(pos.total_shares);
        env.storage().instance().set(&Key::Position, &pos);

        let next_steps: Vec<WorkflowTarget> = env
            .storage()
            .instance()
            .get(&Key::NextSteps)
            .unwrap_or_else(|| Vec::new(&env));
        for step in next_steps.iter() {
            invoke_execute_step(&env, &step.address, &asset, &0);
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("deposit"), vault), (amount, shares_received));
    }

    /// Harvest accrued yield from the vault.
    /// If `reinvest` is true, the yield is deposited back into the vault.
    /// Otherwise it is forwarded to next_steps.
    pub fn harvest(env: Env, reinvest: bool) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        bump_ttl(&env);

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let vault: Address = env.storage().instance().get(&Key::Vault).unwrap();
        let mut pos: VaultPosition = env.storage().instance().get(&Key::Position).unwrap();

        if pos.total_shares <= 0 {
            panic_with_error!(&env, Error::NothingToHarvest);
        }

        // Redeem all shares to get current underlying value
        let redeemed = redeem_from_vault(&env, &vault, pos.total_shares);

        let yield_amount = redeemed.saturating_sub(pos.total_deposited);
        if yield_amount <= 0 {
            // Deposit everything back if no yield
            if redeemed > 0 {
                token::Client::new(&env, &asset).transfer(
                    &env.current_contract_address(),
                    &vault,
                    &redeemed,
                );
                let new_shares = deposit_to_vault(&env, &vault, redeemed);
                pos.total_shares = new_shares;
                env.storage().instance().set(&Key::Position, &pos);
            }
            panic_with_error!(&env, Error::NothingToHarvest);
        }

        if reinvest {
            // Deposit principal + yield back
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &vault,
                &redeemed,
            );
            let new_shares = deposit_to_vault(&env, &vault, redeemed);
            pos.total_deposited = redeemed;
            pos.total_shares = new_shares;
            env.storage().instance().set(&Key::Position, &pos);

            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("harvest"), vault), (yield_amount, true));
        } else {
            // Deposit principal back, forward yield
            let principal = redeemed.saturating_sub(yield_amount);
            if principal > 0 {
                token::Client::new(&env, &asset).transfer(
                    &env.current_contract_address(),
                    &vault,
                    &principal,
                );
                let principal_shares = deposit_to_vault(&env, &vault, principal);
                pos.total_deposited = principal;
                pos.total_shares = principal_shares;
            } else {
                pos.total_deposited = 0;
                pos.total_shares = 0;
            }
            env.storage().instance().set(&Key::Position, &pos);

            let next_steps: Vec<WorkflowTarget> = env
                .storage()
                .instance()
                .get(&Key::NextSteps)
                .unwrap_or_else(|| Vec::new(&env));
            for step in next_steps.iter() {
                token::Client::new(&env, &asset).transfer(
                    &env.current_contract_address(),
                    &step.address,
                    &yield_amount,
                );
                invoke_execute_step(&env, &step.address, &asset, &yield_amount);
            }

            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("harvest"), vault), (yield_amount, false));
        }
    }

    /// Withdraw principal + all accrued yield from the vault and forward to next_steps.
    pub fn withdraw(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        bump_ttl(&env);

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let vault: Address = env.storage().instance().get(&Key::Vault).unwrap();
        let mut pos: VaultPosition = env.storage().instance().get(&Key::Position).unwrap();

        if pos.total_shares <= 0 {
            panic_with_error!(&env, Error::NothingToHarvest);
        }

        let redeemed = redeem_from_vault(&env, &vault, pos.total_shares);
        pos.total_deposited = 0;
        pos.total_shares = 0;
        env.storage().instance().set(&Key::Position, &pos);

        let next_steps: Vec<WorkflowTarget> = env
            .storage()
            .instance()
            .get(&Key::NextSteps)
            .unwrap_or_else(|| Vec::new(&env));
        for step in next_steps.iter() {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &step.address,
                &redeemed,
            );
            invoke_execute_step(&env, &step.address, &asset, &redeemed);
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("withdraw"), vault), redeemed);
    }

    pub fn position(env: Env) -> VaultPosition {
        env.storage()
            .instance()
            .get(&Key::Position)
            .unwrap_or(VaultPosition {
                total_deposited: 0,
                total_shares: 0,
            })
    }

    pub fn vault(env: Env) -> Address {
        env.storage().instance().get(&Key::Vault).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }
}

fn deposit_to_vault(env: &Env, vault: &Address, amount: i128) -> i128 {
    let func = Symbol::new(env, "deposit");
    let result = env.try_invoke_contract::<i128, soroban_sdk::Error>(
        vault,
        &func,
        vec![env, amount.into_val(env)],
    );
    match result {
        Ok(Ok(shares)) => shares,
        _ => panic_with_error!(env, Error::VaultCallFailed),
    }
}

fn redeem_from_vault(env: &Env, vault: &Address, shares: i128) -> i128 {
    let func = Symbol::new(env, "redeem");
    let recipient = env.current_contract_address();
    let result = env.try_invoke_contract::<i128, soroban_sdk::Error>(
        vault,
        &func,
        vec![env, shares.into_val(env), recipient.into_val(env)],
    );
    match result {
        Ok(Ok(amount)) => amount,
        _ => panic_with_error!(env, Error::VaultCallFailed),
    }
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn invoke_execute_step(env: &Env, target: &Address, asset: &Address, amount: &i128) {
    let func = soroban_sdk::Symbol::new(env, "execute_step");
    env.invoke_contract::<()>(
        target,
        &func,
        vec![env, asset.into_val(env), amount.into_val(env)],
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    // A vault that tracks deposits internally: 1 token = 1 share.
    #[contract]
    pub struct MockVault;

    #[contractimpl]
    impl MockVault {
        pub fn __constructor(env: Env, asset: Address) {
            env.storage()
                .instance()
                .set(&symbol_short!("asset"), &asset);
            env.storage().instance().set(&symbol_short!("bal"), &0i128);
        }
        pub fn deposit(env: Env, amount: i128) -> i128 {
            let bal: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("bal"))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&symbol_short!("bal"), &(bal + amount));
            amount // 1 share per token
        }
        pub fn redeem(env: Env, shares: i128, recipient: Address) -> i128 {
            let asset: Address = env
                .storage()
                .instance()
                .get(&symbol_short!("asset"))
                .unwrap();
            let bal: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("bal"))
                .unwrap_or(0);
            let out = if shares > bal { bal } else { shares };
            env.storage()
                .instance()
                .set(&symbol_short!("bal"), &(bal - out));
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &recipient,
                &out,
            );
            out
        }
    }

    // A vault that accrues 10% yield on every redeem.
    #[contract]
    pub struct MockYieldingVault;

    #[contractimpl]
    impl MockYieldingVault {
        pub fn __constructor(env: Env, asset: Address) {
            env.storage()
                .instance()
                .set(&symbol_short!("asset"), &asset);
        }
        pub fn deposit(_env: Env, amount: i128) -> i128 {
            amount
        }
        pub fn redeem(env: Env, shares: i128, recipient: Address) -> i128 {
            let asset: Address = env
                .storage()
                .instance()
                .get(&symbol_short!("asset"))
                .unwrap();
            let amount = shares + shares / 10;
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &recipient,
                &amount,
            );
            amount
        }
    }

    fn make_next_steps(env: &Env, target: &Address) -> Vec<WorkflowTarget> {
        vec![
            env,
            WorkflowTarget {
                address: target.clone(),
                data: String::from_str(env, ""),
            },
        ]
    }

    #[test]
    fn deposits_to_vault_and_tracks_shares() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let vault = env.register(MockVault, (asset.address(),));
        let next = env.register(Dummy, ());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Yield,
            (
                admin.clone(),
                asset.address(),
                vault.clone(),
                make_next_steps(&env, &next),
                parent.clone(),
            ),
        );
        let client = YieldClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &500);
        client.receive_and_forward(&predecessor, &asset.address(), &500, &vec![&env]);

        let pos = client.position();
        assert_eq!(pos.total_deposited, 500);
        assert_eq!(pos.total_shares, 500);
    }

    #[test]
    fn harvests_yield_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let vault = env.register(MockYieldingVault, (asset.address(),));
        let next = env.register(Dummy, ());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Yield,
            (
                admin.clone(),
                asset.address(),
                vault.clone(),
                make_next_steps(&env, &next),
                parent.clone(),
            ),
        );
        let client = YieldClient::new(&env, &contract_id);

        // Mint extra tokens to the vault so it can pay 10% yield
        sac.mint(&vault, &100);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(&predecessor, &asset.address(), &1_000, &vec![&env]);

        let pos_before = client.position();
        assert_eq!(pos_before.total_deposited, 1_000);
        assert_eq!(pos_before.total_shares, 1_000);

        client.harvest(&false);

        let pos_after = client.position();
        // Principal redeposited, shares updated to 1000 (mock returns 1:1 for deposit)
        assert_eq!(pos_after.total_deposited, 1_000);
    }

    #[test]
    fn withdraws_all_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let vault = env.register(MockYieldingVault, (asset.address(),));
        let next = env.register(Dummy, ());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Yield,
            (
                admin.clone(),
                asset.address(),
                vault.clone(),
                make_next_steps(&env, &next),
                parent.clone(),
            ),
        );
        let client = YieldClient::new(&env, &contract_id);

        // Mint extra yield tokens to vault
        sac.mint(&vault, &50);

        tok.transfer(&predecessor, &contract_id, &500);
        client.receive_and_forward(&predecessor, &asset.address(), &500, &vec![&env]);

        client.withdraw();

        let pos = client.position();
        assert_eq!(pos.total_deposited, 0);
        assert_eq!(pos.total_shares, 0);
    }

    #[test]
    fn reinvest_compounds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let vault = env.register(MockYieldingVault, (asset.address(),));
        let next = env.register(Dummy, ());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Yield,
            (
                admin.clone(),
                asset.address(),
                vault.clone(),
                make_next_steps(&env, &next),
                parent.clone(),
            ),
        );
        let client = YieldClient::new(&env, &contract_id);

        // Mint extra yield tokens to vault
        sac.mint(&vault, &100);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(&predecessor, &asset.address(), &1_000, &vec![&env]);

        client.harvest(&true);

        let pos = client.position();
        // After harvest+reinvest, total_deposited should be 1100 (1000 + 10% yield)
        assert_eq!(pos.total_deposited, 1_100);
    }
}
