import { Keypair } from "@stellar/stellar-sdk";

// HKDF salt is separate so HKDF context is distinct from the PRF eval context.
export const HKDF_SALT = new TextEncoder().encode("pinkraft-stellar-keypair-v1");

export async function deriveKeypair(prfOutput: ArrayBuffer): Promise<Keypair> {
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
