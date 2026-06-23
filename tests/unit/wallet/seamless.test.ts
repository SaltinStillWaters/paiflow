import { describe, it, expect } from "vitest";
import { deriveKeypair } from "@/lib/wallet/seamless-derive";

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
