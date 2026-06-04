# Paiflow Whitepaper

This directory contains the long-form Paiflow whitepaper — the canonical external-facing document that introduces the product, architecture, and direction to partners, integrators, investors, and the broader Stellar ecosystem.

## What's in this directory

| File                      | Purpose                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PAIFLOW_WHITEPAPER.md`   | The whitepaper itself (v0.1). Read top to bottom in ~25 minutes.                                                                                                   |
| `figures/`                | Pre-rendered diagrams referenced from the whitepaper. Empty in v0.1 — diagrams live inline as `mermaid` blocks. Reserve this directory for future SVG/PNG exports. |
| `README.md` _(this file)_ | What you're reading right now.                                                                                                                                     |

## How to read it

The whitepaper is organised into 12 numbered sections. Suggested entry points by reader:

- **Stellar ecosystem reviewers / SDF judges** — §1 (exec summary) → §4 (why Stellar) → §5 (architecture) → §6 (contracts) → §8 (security).
- **Prospective integrator partners** — §1 → §3 (solution) → §6 (contracts) → §9 (use cases) → §12 (appendix links).
- **Investors / advisors** — §1 → §2 (problem) → §3 (solution) → §10 (roadmap) → §11 (team).
- **Prospective contributors / hires** — §5 (architecture) → §7 (AI authoring) → §8 (security) → §11 (team & open-source).
- **End users** — start with the [product README](../../README.md) instead. The whitepaper assumes you've used Paiflow once.

## Version

**v0.1.** The whitepaper is a living document. Markdown is the source of truth in this version. A PDF export, a hosted `/whitepaper` web route, and translations are explicitly deferred to follow-up cycles.

The §10 Roadmap is a deliberate placeholder in v0.1 — it describes direction, not dated commitments, and will be replaced with a concrete roadmap once the team locks priorities.

## How it relates to other docs

- [`README.md`](../../README.md) — quick-start, hackathon-format summary, run-locally.
- [`SPEC.md`](../../SPEC.md) — internal engineering spec. Source of truth for implementation detail. The whitepaper summarises and links; it does not duplicate.
- [`AGENT.md`](../../AGENT.md) — engineering conventions for coding agents working on the codebase.
- [`BRAND.md`](../../BRAND.md) — visual system and voice. Will need a Paiflow-rebranded refresh.
- [`docs/features.md`](../features.md) — running changelog of user-visible features.
- [`docs/soroban-smart-contracts.md`](../soroban-smart-contracts.md) — primer on Soroban with Paiflow-specific notes.
- [`docs/mainnet-cutover.md`](../mainnet-cutover.md) — operator runbook for the testnet → mainnet transition.

## Contributing

This whitepaper lives in the repo and is versioned with the code. Edits and corrections go through the same PR review flow as code changes. Substantive rewrites (anything beyond typo / link / phrasing) should be discussed in an issue first so the editorial direction stays coherent.
