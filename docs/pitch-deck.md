---
marp: true
theme: default
class: invert
size: 16:9
paginate: true
title: Pink Raft — Investor Pitch (v3)
description: Zaps for Payments. Powered by Stellar.
style: |
  :root {
    --pr-bg: #0e0e0e;
    --pr-surface: #1c1b1b;
    --pr-fg: #e5e2e1;
    --pr-muted: #ac878f;
    --pr-pink: #ffb1c4;
    --pr-hot: #ff007f;
    --pr-blue: #98cbff;
    --pr-amber: #ffba20;
  }
  section {
    background-color: var(--pr-bg);
    color: var(--pr-fg);
    font-family: "Geist", "Inter", system-ui, sans-serif;
    background-image:
      linear-gradient(to right, rgba(0,162,253,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0,162,253,0.04) 1px, transparent 1px);
    background-size: 32px 32px, 32px 32px;
    padding: 64px 80px;
  }
  section.title {
    background-image:
      radial-gradient(circle at 30% 40%, rgba(255,0,127,0.18) 0%, transparent 60%),
      radial-gradient(circle at 80% 70%, rgba(0,162,253,0.12) 0%, transparent 60%),
      linear-gradient(to right, rgba(0,162,253,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0,162,253,0.04) 1px, transparent 1px);
    background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
  }
  h1, h2, h3 {
    font-family: "Space Grotesk", "Geist", sans-serif;
    color: var(--pr-fg);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  h1 { font-size: 64px; font-weight: 700; }
  h2 { font-size: 44px; font-weight: 600; margin-bottom: 24px; }
  h3 { font-size: 28px; font-weight: 600; color: var(--pr-pink); }
  .eyebrow {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 14px;
    color: var(--pr-pink);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .tagline {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 20px;
    color: var(--pr-blue);
    letter-spacing: 0.04em;
  }
  .mono, code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    color: var(--pr-blue);
  }
  .pink { color: var(--pr-pink); font-weight: 600; }
  .hot { color: var(--pr-hot); font-weight: 700; }
  .amber { color: var(--pr-amber); }
  .muted { color: var(--pr-muted); }
  ul, ol { font-size: 22px; line-height: 1.5; }
  li { margin-bottom: 8px; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 16px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 18px;
  }
  th, td {
    border: 1px solid rgba(172,135,143,0.25);
    padding: 12px 16px;
    text-align: left;
  }
  th {
    background: rgba(255,177,196,0.08);
    color: var(--pr-pink);
    font-weight: 600;
  }
  section::after {
    color: var(--pr-muted);
    font-family: "JetBrains Mono", ui-monospace, monospace;
  }
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
  .columns-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 24px;
  }
  .card {
    border: 1px solid rgba(172,135,143,0.25);
    border-radius: 8px;
    padding: 20px;
    background: rgba(28,27,27,0.5);
  }
  .card h3 { font-size: 20px; margin-top: 0; }
  .card p { font-size: 16px; color: var(--pr-fg); margin: 8px 0 0; }
  .qa table { font-size: 15px; }
  .qa th, .qa td { padding: 8px 12px; }
  footer { color: var(--pr-muted); font-family: "JetBrains Mono", monospace; }
---

<!-- _class: title -->
<!-- _paginate: false -->

<div class="eyebrow">▮ PINK RAFT · INVESTOR DECK · V3</div>

# Pink Raft

<div class="tagline">Zaps for Payments. <span class="hot">Powered by Stellar.</span></div>

<br>

**Drag. Drop. Deploy.** — programmable payments on Stellar Soroban, with **no Rust** and **no devs**. <span class="pink">Live on mainnet today.</span>

<br>

<span class="muted mono">v3 · JULY 2026</span>

---

<div class="eyebrow">§ 01 · PROBLEM</div>

## Programmable payments are <span class="pink">locked behind engineers.</span>

- Every fintech, SMB, payroll team, or DAO that wants conditional, scheduled, or split payments today must **hire Rust developers** — or be stuck with off-the-shelf SaaS that doesn't fit.
- Stellar's **Soroban** unlocks programmable money, but the UX is "go learn a smart-contract toolchain."
- **There is no middle layer** between "send-a-payment button" and "build-your-own contract," and fiat on/off-ramp rails are rarely integrated with the automation layer at all.

<br>

<span class="mono">→ Result: 99% of operators who'd benefit can't ship.</span>

---

<div class="eyebrow">§ 02 · SOLUTION</div>

## Pink Raft is that middle layer.

<div class="columns">

<div>

**A visual builder** for payment automations.

- Drag a **trigger** (`On Receive`, `On Schedule`, API, email).
- Drop an **action** (`Pay`, `Split`, `Stream`).
- Add **logic** (oracle, threshold, multisig).
- Click **Deploy** → a pre-audited Soroban contract is live in **~90 seconds**.

</div>

<div>

**Non-custodial by design.** Pink Raft never holds keys — users sign in their own wallet.

**AI-assisted authoring.** Describe the flow in plain English; "Raft Log" drafts the canvas from voice.

**20 production contract templates** — not a demo set — cover real-world payment patterns out of the gate.

</div>

</div>

---

<div class="eyebrow">§ 03 · DEMO BEAT</div>

## <span class="pink">90 seconds</span> from idea to on-chain.

<div class="columns-3">

<div class="card">
<h3 class="mono">01 · DRAG</h3>
<p>Pick <code>On Receive USDC</code> from the palette. Drop it on the canvas.</p>
</div>

<div class="card">
<h3 class="mono">02 · DROP</h3>
<p>Add <code>Split 60 / 30 / 10</code> to three wallets — Alice, Bob, Charlie.</p>
</div>

<div class="card">
<h3 class="mono">03 · DEPLOY</h3>
<p>Sign in Freighter. QR code appears. Scan, send <span class="pink">10 USDC</span>, watch three payouts fan out live.</p>
</div>

</div>

<br>

<span class="mono muted">→ Same loop powers payroll, treasury, escrow, marketplaces, DAO ops.</span>

---

<div class="eyebrow">§ 04 · WHAT YOU CAN BUILD</div>

## Real-world payment workflows, <span class="pink">visually.</span>

<div class="columns">

<div>

- **Auto-schedule salaries** — pay 50 contractors every 1st & 15th, in USDC.
- **API-triggered payouts** — Shopify webhook → split revenue with co-founders.
- **Email-triggered payments** — invoice paid → release affiliate commission.
- **Oracle-conditional escrow** — release funds if BTC > $X or game outcome resolves.

</div>

<div>

- **Streaming compensation** — pay grants per-second over 12 months.
- **Notify on payout** — email/SMS recipients when their tranche lands.
- **Prediction-market settlement** — auto-distribute pool to winning side.
- **Tiered treasury rules** — 70% ops, 20% reserve, 10% community, every inflow.

</div>

</div>

<br>

<span class="mono muted">Every block composes. Every flow becomes one Soroban contract on Stellar.</span>

---

<div class="eyebrow">§ 05 · WHY STELLAR · WHY NOW</div>

## <span class="pink">Stellar is the payment rail.</span> Soroban makes it programmable. We make it usable.

<div class="columns">

<div>

**Stellar:** ~5s settlement, sub-cent fees, native USDC, regulated on-ramps, and **real adoption with payment companies** (MoneyGram, Circle, IBM World Wire alumni).

**Soroban:** mainnet-live Rust smart-contract platform purpose-built for payments and assets.

</div>

<div>

**The shift now:**

- **No-code** is how SaaS scaled from devs to operators (Zapier, Retool, Webflow).
- **AI** collapses the last mile — describe the flow, get the contract.
- **Stablecoins** are eating cross-border payments.
- **Protocol tailwinds:** Protocol 23's parallel Soroban execution (~40% CPU efficiency) adds throughput headroom; Protocol 21's secp256r1 support is what makes native passkey UX possible.

</div>

</div>

---

<div class="eyebrow">§ 06 · STELLAR ECOSYSTEM IMPACT</div>

## Every flow is <span class="pink">Stellar-native economic activity.</span>

<div class="columns">

<div>

- Each deployed flow is a **new Soroban contract instance** — direct growth in mainnet contract deployments and transaction volume.
- Drives **stablecoin trustline & transfer volume**: Stellar USDC already carries **$83M+ supply**, **$4.2B+ transfer volume**, **500K+ trustlines** (as of Jul 2026).
- Lowers the barrier for SMBs, DAOs, and remittance operators to become Stellar-native — expanding *real* economic usage beyond speculation.

</div>

<div>

- Our **PDAX off-ramp** bridges Stellar-settled value directly to Philippine peso bank rails — a working on/off-ramp use case, not a theoretical one.
- **Horizontal infrastructure effect:** integrate a DEX, oracle, or anchor once — every flow built on Pink Raft can use it. Each ecosystem integration compounds in value.

</div>

</div>

<br>

<span class="mono muted">→ Pink Raft doesn't just use Stellar — it multiplies what every other Stellar integration is worth.</span>

---

<div class="eyebrow">§ 07 · ECOSYSTEM INTEGRATION ROADMAP (I)</div>

## Plugging into Stellar's <span class="pink">DEX & anchor layer.</span>

<div class="columns-3">

<div class="card">
<h3 class="mono">SOROSWAP</h3>
<p>Replace the <code>swapper</code> action's fixed-rate stub with a real Soroban call into Soroswap's router — genuine on-chain pricing & execution.</p>
</div>

<div class="card">
<h3 class="mono">SEP-24 / SEP-31</h3>
<p>Generalize the existing <code>OffRampProvider</code> interface into a standard anchor path: SEP-24 for consumer hosted deposit/withdrawal, SEP-31 for cross-border B2B.</p>
</div>

<div class="card">
<h3 class="mono">MONEYGRAM RAMPS</h3>
<p>Second off-ramp provider via MGUSD (launched Jun 2026) — 500K+ cash-pickup locations, 170+ countries, 15+ wallets.</p>
</div>

</div>

<br>

<span class="mono muted">→ Listing in the Stellar Anchor Directory follows naturally once the off-ramp interface is generalized.</span>

---

<div class="eyebrow">§ 07 · ECOSYSTEM INTEGRATION ROADMAP (II)</div>

## Oracles, wallets & <span class="pink">security-first sequencing.</span>

<div class="columns-3">

<div class="card">
<h3 class="mono">REFLECTOR</h3>
<p>Powers <code>conditional</code>'s <code>OracleGte</code> and the <code>oracle</code> trigger. <span class="hot">TWAP / multi-block confirmation required</span> — designed around Blend Capital's Feb 2026 $10.8M oracle exploit, not after it.</p>
</div>

<div class="card">
<h3 class="mono">BLEND CAPITAL</h3>
<p>Real yield vault for the <code>yield</code> action — deliberately sequenced <span class="pink">after</span> oracle hardening, scoped as a dedicated, security-reviewed workstream, not a quick win.</p>
</div>

<div class="card">
<h3 class="mono">PASSKEYS</h3>
<p>Stellar's composable auth model + Protocol 21 secp256r1 — the single highest-impact onboarding fix for OFW/MSME users who struggle with seed phrases.</p>
</div>

</div>

<br>

<span class="mono muted">Trustless Work is the closest Soroban analog (escrow-only) — we differentiate on conditional + multisig + timelock composability. SCF 7.0's Integration track (up to $150K in XLM) is the funding path for this roadmap.</span>

---

<div class="eyebrow">§ 08 · MARKET</div>

## Target: <span class="pink">operators</span>, not protocol engineers.

<div class="columns">

<div>

**Initial wedge**

- **Crypto-native SMBs & DAOs** — payroll, treasury, contributor payouts.
- **Web3 fintechs** building on Stellar — embed Pink Raft flows as their payments layer.
- **Remittance & payout operators** — programmable splits at the edge.

</div>

<div>

**Why they buy**

- Today: Rust contractor at $150/hr, 2-week build, ongoing audits.
- With Pink Raft: **launch in an afternoon**, audited templates, no custody risk.

**TAM signal:** Zapier crossed $200M ARR by being a verb — the same shape for money. An unprompted Ask HN thread ("Does a Zapier for payment automation exist?") validates the demand.

</div>

</div>

---

<div class="eyebrow">§ 09 · GO-TO-MARKET</div>

## Land in the <span class="pink">Philippines</span>, expand across <span class="pink">APAC</span>, scale <span class="pink">Global.</span>

<div class="columns-3">

<div class="card">
<h3 class="mono">PHASE 1 · NOW–Q3'26</h3>
<p><b>Philippines.</b> Beachhead — live PDAX off-ramp + InstaPay rails. Target: OFW remittance & BPO/remote-team payroll. Channel: direct partnerships with PH crypto exchanges & MSME payroll providers. Pilot with 2–3 design partners already moving payments.</p>
</div>

<div class="card">
<h3 class="mono">PHASE 2 · Q4'26–'27</h3>
<p><b>APAC.</b> Add anchors/off-ramp providers per market — not bespoke rails — leaning on MoneyGram's 170+ country footprint. Target: PH/Indonesia/Vietnam remittance corridors & regional Web3 fintechs. Channel: SCF-funded integrations, regional exchange partners, Stellar APAC community.</p>
</div>

<div class="card">
<h3 class="mono">PHASE 3 · '27+</h3>
<p><b>Global.</b> Multi-stablecoin (USDC/EURC/YLDS), template marketplace, embeddable SDK for white-label fintech partners. Channel: self-serve funnel + enterprise sales + SDF co-marketing.</p>
</div>

</div>

---

<div class="eyebrow">§ 09 · GO-TO-MARKET (CONTINUED)</div>

## Pilots and channels that <span class="pink">de-risk each phase.</span>

- **Pilot-first validation** — partner with 2 other MVP-stage projects already using programmable payments (payroll, marketplace) as embedded design partners before broad launch.
- **Off-ramp as the wedge** — PDAX solves the fiat-conversion pain point most no-code automation tools ignore entirely.
- **Community & funding-led growth** — SCF grants fund each new integration with non-dilutive capital *and* ecosystem visibility.
- **Self-serve funnel** — Free → Starter → Pro → Business → Enterprise, activated once core integrations ship.

---

<div class="eyebrow">§ 10 · PRICING (INITIAL)</div>

## Self-serve SaaS, billed per active flow.

| Tier           | Price         | What you get                                                    |
| -------------- | ------------- | --------------------------------------------------------------- |
| **Free**       | $0            | 1 active flow · testnet · community support                     |
| **Starter**    | **$29 / mo**  | 5 flows · mainnet · email notifications · 10k events/mo         |
| **Pro**        | **$149 / mo** | 25 flows · API + webhook triggers · SMS · 100k events · SLAs    |
| **Business**   | **$499 / mo** | Unlimited flows · SSO · audit log export · 1M events · priority |
| **Enterprise** | Custom        | Dedicated infra · custom templates · contract audits · co-sell  |

<br>

<span class="mono muted">Revenue add-ons: per-event metering above tier, white-label embed, and template marketplace rev share.</span>

---

<div class="eyebrow">§ 11 · ROADMAP</div>

## Sequenced for <span class="pink">security</span>, not just speed.

<div class="columns-3">

<div class="card">
<h3 class="mono">NOW · H2'26</h3>
<p>Generalize the off-ramp interface; ship MoneyGram as 2nd provider. Close test-coverage gaps (<code>cash_out</code>, <code>factory</code> currently untested). Retire/rewrite the stale SPEC.md.</p>
</div>

<div class="card">
<h3 class="mono">NEXT · H1'27</h3>
<p>Soroswap integration for real DEX pricing in <code>swapper</code>. Reflector oracle with TWAP hardening for <code>conditional</code>/<code>oracle</code> trigger. Passkey-based onboarding.</p>
</div>

<div class="card">
<h3 class="mono">LATER · '27+</h3>
<p>Blend Capital yield integration — after oracle hardening, security-reviewed. Template marketplace; multi-chain support; embeddable SDK.</p>
</div>

</div>

<br>

<span class="mono muted">Built non-custodial from day one — no money-transmitter risk; users sign every action.</span>

---

<div class="eyebrow">§ 12 · TEAM · ASK</div>

## Team

<div class="columns">

<div>

### Founders <span class="muted mono">[placeholder]</span>

- **[Name]** — CEO · ex-[Co], built [thing]
- **[Name]** — CTO · ex-[Co], Stellar/Soroban contributor
- **[Name]** — Design · ex-[Co], shipped [product]

### Advisors <span class="muted mono">[placeholder]</span>

- [Name] — Stellar Development Foundation
- [Name] — Payments / fintech operator

</div>

<div>

### The ask

**Two tracks:**

- **Immediate:** applying to SCF 7.0's Integration track (up to $150K in XLM) — non-dilutive funding for the ecosystem integration roadmap already scoped.
- **Raising $[X]M seed** to fund team growth and GTM execution across Philippines → APAC → Global, ship the integration roadmap (Soroswap, Reflector, passkeys), onboard the first **50 paying SMBs / DAOs**, and fund external audits of every shipped template.

<br>

<span class="hot mono">→ Let's build the payment layer for Stellar.</span>

</div>

</div>

<br>

<span class="muted mono">contact@pinkraft.app · pinkraft.xyz · github.com/webnxt-2030/pinkraft</span>

---

<!-- _class: title -->

<div class="eyebrow">▮ APPENDIX · INVESTOR & JUDGE Q&A</div>

## Anticipated questions, <span class="pink">answered.</span>

<span class="tagline">25 questions across product, ecosystem, business, GTM, and team/risk — read this before you present.</span>

---

<div class="eyebrow">APPENDIX A · PRODUCT & TECHNOLOGY</div>

## Q&A — <span class="pink">Product & Technology</span>

<div class="qa">

| # | Question | Answer |
| - | -------- | ------ |
| 1 | Is this really live, or a prototype? | Live on Stellar mainnet today at pinkraft.xyz. Production PDAX off-ramp and payroll are shipped features, not roadmap items. |
| 2 | How is Pink Raft actually non-custodial? | Contracts execute against user-controlled Stellar accounts; users sign every action in their own wallet. The payroll relayer only sponsors gas — it never holds funds. |
| 3 | What's the real template count and test coverage? | 20 production contract templates; most carry dedicated test suites (e.g. splitter: 19 tests, subscription: 11). Two known gaps — `cash_out` and `factory` — have 0 tests and are tracked, not hidden. |
| 4 | How does the AI voice assistant ("Raft Log") work, and is it safe? | Groq Whisper (speech-to-text) + Llama converts a spoken description into a draft flow on the canvas. The user always reviews and explicitly deploys — the AI never moves funds autonomously. |
| 5 | What happens if a deployed contract has a bug? | Standard flows use fixed, audited templates, which shrinks novel-bug surface. The separate dev-mode mutable-contract pipeline is relayer-gated and machine-authenticated, isolating that risk from production flows. |

</div>

---

<div class="eyebrow">APPENDIX B · STELLAR ECOSYSTEM & PROTOCOL</div>

## Q&A — <span class="pink">Stellar Ecosystem & Protocol</span>

<div class="qa">

| # | Question | Answer |
| - | -------- | ------ |
| 6 | Why Stellar specifically, not Ethereum, Solana, or another chain? | Sub-5-second settlement, sub-cent fees, native stablecoin rails, and a Soroban contract model built for payments — plus existing Philippine anchor/off-ramp rails we already integrate with. |
| 7 | What's Pink Raft's measurable contribution to the Stellar network? | Every deployed flow is a new Soroban contract instance, and every flow drives stablecoin trustline/transfer volume. Our PDAX integration is a working bridge from Stellar-settled value to PHP bank rails. |
| 8 | How do you handle oracle risk, given exploits like Blend Capital's? | We require TWAP/multi-block confirmation for our Reflector integration by design — a direct response to Blend's Feb 2026 $10.8M raw-price oracle exploit — and we sequence Blend yield integration *after* that hardening, as its own security-reviewed workstream. |
| 9 | Are you dependent on future protocol upgrades like Protocol 23? | No. Protocol 23's parallel execution is a throughput tailwind, not a dependency — everything shipped today runs on already-live Soroban capability. |
| 10 | How do you differentiate from other Soroban projects like Trustless Work? | Trustless Work is escrow-only. Pink Raft composes conditional logic, multisig, and timelocks on one canvas, plus a working production fiat off-ramp — broader and more integrated than a single-purpose escrow tool. |

</div>

---

<div class="eyebrow">APPENDIX C · BUSINESS MODEL & MARKET</div>

## Q&A — <span class="pink">Business Model & Market</span>

<div class="qa">

| # | Question | Answer |
| - | -------- | ------ |
| 11 | What's the actual revenue model? | Tiered SaaS priced by active flow count (Free → Enterprise), with planned add-ons: per-event metering, white-label embed, and template marketplace revenue share. |
| 12 | How big is the addressable market, really? | Zapier is a ~$200M ARR proof of the demand shape. Our wedge — crypto-native SMBs/DAOs, Web3 fintechs, remittance operators — is narrower but already Stellar/stablecoin-adjacent, and an organic Ask HN thread validated the exact positioning. |
| 13 | What's the concrete customer acquisition plan? | Pilot first with 2 design-partner projects, lead with the off-ramp wedge, grow via SCF-grant visibility and community, then activate a self-serve funnel once core integrations ship. |
| 14 | Who are you actually competing with? | Three alternatives: hiring a Rust contractor (slow, expensive), Web2 automation tools like Zapier (no native settlement), and single-purpose Soroban tools like Trustless Work (not composable). We beat all three on speed-to-ship plus native settlement. |
| 15 | What do the unit economics look like? | Standard SaaS software margins. Payroll gas costs are relayer-sponsored and amortized into subscription pricing; off-ramp provider fees pass through to the user rather than being a Pink Raft revenue line. |

</div>

---

<div class="eyebrow">APPENDIX D · GTM & GEOGRAPHY</div>

## Q&A — <span class="pink">GTM & Geography</span>

<div class="qa">

| # | Question | Answer |
| - | -------- | ------ |
| 16 | Why start in the Philippines specifically? | We already have live rails there — PDAX off-ramp and InstaPay bank deposit are shipped, not aspirational — serving a large OFW remittance and BPO/remote-team payroll market. |
| 17 | How do you expand into APAC without rebuilding rails per country? | We generalize the `OffRampProvider` interface around SEP-24/SEP-31 and lean on MoneyGram Ramps' 170+ country footprint, instead of building bespoke integrations market by market. |
| 18 | What does the "Global" phase actually require that isn't true today? | Multi-stablecoin support (EURC/YLDS alongside USDC), a template marketplace, and an embeddable SDK for white-label partners — an explicit gap list, not vague ambition. |
| 19 | How do you handle regulatory differences (money transmission, KYC) market to market? | Pink Raft's non-custodial design limits our own money-transmitter exposure; KYC and cash-out compliance are handled by regulated anchor partners (PDAX, MoneyGram), not by us directly. |
| 20 | What's the funding need and use of funds? | Two tracks: a non-dilutive SCF 7.0 Integration grant (up to $150K in XLM) for the near-term integration roadmap, and a seed round to fund team growth and GTM execution across all three phases. |

</div>

---

<div class="eyebrow">APPENDIX E · TEAM, RISK & ASK</div>

## Q&A — <span class="pink">Team, Risk & Ask</span>

<div class="qa">

| # | Question | Answer |
| - | -------- | ------ |
| 21 | What's the biggest technical risk? | Oracle-dependent DeFi integrations (yield via Blend Capital) — mitigated by sequencing them after Reflector/TWAP hardening and treating them as a dedicated, security-reviewed workstream. |
| 22 | What's the biggest business risk? | Concentration on a single off-ramp provider (PDAX) — mitigated by generalizing the off-ramp interface and adding MoneyGram Ramps as a second provider. |
| 23 | Why should investors trust the traction claims? | The product is live and checkable at pinkraft.xyz, the code is public on GitHub, and our own audit (filed as a public issue) documents exact current state — including the gaps — rather than only the wins. |
| 24 | What have you deliberately not built yet, and why? | Real DEX swaps (Soroswap), hardened oracle pricing (Reflector), Blend yield, and passkeys are all sequenced deliberately on the roadmap — not oversights, but ordered by security dependency and impact. |
| 25 | What does success look like in 12 months? | MoneyGram live as a second off-ramp provider, Soroswap and hardened Reflector shipped, paying customers across the Philippines plus at least one other APAC market, and the SCF grant milestones completed. |

</div>
