// Seamless (invisible) wallet integration stub.
//
// Goal: allow users to sign Stellar transactions without installing Freighter or
// any other wallet extension. The wallet must remain non-custodial — private keys
// stay with the user, never on our servers.
//
// Candidates to evaluate (see issue #178):
//   - Privy (privy.io) — embedded wallets, social/email login, non-custodial MPC
//   - Passkey-based wallets (WebAuthn) — no extension, device-native signing
//   - Turnkey (turnkey.com) — policy-controlled non-custodial key management
//
// This file is the integration surface. Replace the stub below once a provider
// is selected and POC-validated.

export type SeamlessWallet = {
  address: string;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
};

export async function getSeamlessWallet(): Promise<SeamlessWallet> {
  throw new Error("Seamless wallet not implemented yet — see issue #178");
}
