import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { requireSession } from "@/lib/auth";

const PostSchema = z.object({
  credentialId: z.string(),
  address: z.string().refine(StrKey.isValidEd25519PublicKey, "Invalid Stellar address"),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const body = PostSchema.parse(await req.json());
    const credentialIdBuf = Buffer.from(body.credentialId, "base64url");

    const passkey = await db.passkey.findFirst({
      where: { userId: user.id, credentialId: credentialIdBuf },
    });
    if (!passkey) throw new AppError("NOT_FOUND", "Passkey not found for this account");

    if (!passkey.walletAddress) {
      await db.passkey.update({
        where: { id: passkey.id },
        data: { walletAddress: body.address },
      });
      return NextResponse.json({ data: { mismatch: false } });
    }

    if (passkey.walletAddress !== body.address) {
      return NextResponse.json({
        data: { mismatch: true, expected: passkey.walletAddress },
      });
    }

    return NextResponse.json({ data: { mismatch: false } });
  });
}
