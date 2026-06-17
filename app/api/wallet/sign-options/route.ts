import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler } from "@/lib/errors";
import { saveChallenge } from "@/lib/passkey/challenges";
import { rp } from "@/lib/passkey/rp";
import { requireSession } from "@/lib/auth";

export async function POST() {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { rpID } = rp();

    const passkeys = await db.passkey.findMany({ where: { userId: user.id } });

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const challengeB64 = Buffer.from(challenge).toString("base64url");
    await saveChallenge("wallet-sign", user.id, challengeB64);

    return NextResponse.json({
      data: {
        challenge: challengeB64,
        rpId: rpID,
        allowCredentials: passkeys.map((p) => ({
          id: Buffer.from(p.credentialId).toString("base64url"),
          type: "public-key" as const,
          transports: p.transports as AuthenticatorTransport[],
        })),
        userVerification: "preferred" as const,
      },
    });
  });
}
