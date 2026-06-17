"use client";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

// Fixed eval input — same salt every time so the derived Stellar key is deterministic per credential.
const PRF_EVAL_SALT = new TextEncoder().encode("pinkraft-stellar-wallet-v1");
// HKDF salt is separate so HKDF context is distinct from the PRF eval context.
const HKDF_SALT = new TextEncoder().encode("pinkraft-stellar-keypair-v1");

function base64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return result;
}

async function deriveKeypair(prfOutput: ArrayBuffer): Promise<Keypair> {
  const keyMaterial = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: new Uint8Array() },
    keyMaterial,
    256,
  );
  return Keypair.fromRawEd25519Seed(Buffer.from(derived));
}

async function authenticateAndDeriveKeypair(): Promise<Keypair> {
  const res = await fetch("/api/wallet/sign-options", { method: "POST" });
  if (!res.ok) throw new Error("Failed to get passkey challenge");
  const { data: opts } = await res.json();

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: base64urlToBytes(opts.challenge),
      rpId: opts.rpId,
      allowCredentials: (opts.allowCredentials ?? []).map(
        (c: { id: string; transports?: AuthenticatorTransport[] }) => ({
          type: "public-key" as const,
          id: base64urlToBytes(c.id),
          transports: c.transports,
        }),
      ),
      userVerification: "preferred",
      extensions: { prf: { eval: { first: PRF_EVAL_SALT.buffer as ArrayBuffer } } },
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Passkey authentication cancelled");

  type WithPrf = AuthenticationExtensionsClientOutputs & {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfFirst = (credential.getClientExtensionResults() as WithPrf)?.prf?.results?.first;
  if (!prfFirst) {
    throw new Error(
      "Your browser does not support the PRF extension. Use Chrome or Safari with Touch ID or a hardware security key.",
    );
  }

  return deriveKeypair(prfFirst);
}

export type SeamlessWallet = {
  address: string;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
};

export async function getSeamlessWallet(): Promise<SeamlessWallet> {
  const keypair = await authenticateAndDeriveKeypair();
  return {
    address: keypair.publicKey(),
    signTransaction: async (xdr, networkPassphrase) => {
      const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      tx.sign(keypair);
      return tx.toEnvelope().toXDR("base64");
    },
  };
}
