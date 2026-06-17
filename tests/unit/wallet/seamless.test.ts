import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const HKDF_SALT = new TextEncoder().encode("pinkraft-stellar-keypair-v1");

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

describe("seamless wallet key derivation", () => {
  it("derives the same keypair from identical PRF output", async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const kp1 = await deriveKeypair(prf.buffer);
    const kp2 = await deriveKeypair(prf.buffer);
    expect(kp1.publicKey()).toBe(kp2.publicKey());
  });

  it("derives different keypairs from different PRF outputs", async () => {
    const kp1 = await deriveKeypair(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const kp2 = await deriveKeypair(crypto.getRandomValues(new Uint8Array(32)).buffer);
    expect(kp1.publicKey()).not.toBe(kp2.publicKey());
  });

  it("produces a valid Stellar G-address", async () => {
    const kp = await deriveKeypair(crypto.getRandomValues(new Uint8Array(32)).buffer);
    expect(kp.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
  });
});
