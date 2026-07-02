import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { Prisma, ChargeRelayerMode, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { env, devDeployOwnerId, stellarRelayerAddress, stellarWasmHash } from "@/lib/env";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { preparePipelineDeployTx, submitDeployTxByRelayer } from "@/lib/stellar/deploy";
import { withRelayerLock } from "@/lib/stellar/client";
import type { SubmitResult, PreparedPipelineDeploy } from "@/lib/stellar/deploy";
import type { FlowGraph, Asset } from "@/lib/flows/schema";

const AssetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({ kind: z.literal("known"), symbol: z.enum(["USDC"]) }),
  z.object({
    kind: z.literal("custom"),
    code: z.string().regex(/^[A-Za-z0-9]{1,12}$/, "Asset code must be 1-12 alphanumeric chars"),
    issuer: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid issuer"),
  }),
]);

const BodySchema = z.object({
  asset: AssetSchema,
});

type PipelineSnapshotEntry = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

/**
 * Deploy a new dev-mode payroll pipeline (SUBSCRIPTION_DEV → SPLITTER_DEV)
 * using machine auth. The backend relayer both signs and submits the factory
 * transaction; the caller only needs to provide the asset. Recipients, bank
 * details, employer, and schedule are intentionally out of scope and are filled
 * via the existing dev-* endpoints after deploy.
 *
 * Auth: x-dev-api-secret header (falls back to session auth).
 */
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req, { role: Role.ADMIN });
    const rlKey = user ? `dev-deploy:${user.id}` : `dev-deploy:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 10, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many dev payroll deploys");

    const network = env().STELLAR_NETWORK;
    if (network === "mainnet") {
      throw new AppError("FORBIDDEN", "dev-mode payroll deploy is not allowed on mainnet");
    }

    // Idempotency: a retry carrying the same key returns the original deployment
    // instead of deploying a second set of contracts.
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
    if (idempotencyKey) {
      const existing = await db.deployment.findUnique({ where: { idempotencyKey } });
      if (existing) return NextResponse.json({ data: serializeDeployment(existing) });
    }

    const body = BodySchema.parse(await req.json());
    const ownerId = user?.id ?? devDeployOwnerId();
    if (!ownerId) {
      throw new AppError(
        "INTERNAL",
        "DEV_DEPLOY_OWNER_ID is required for machine-auth payroll deploy",
      );
    }

    const relayerAddress = stellarRelayerAddress();
    if (!relayerAddress) {
      throw new AppError("INTERNAL", "STELLAR_RELAYER_ADDRESS is not configured");
    }

    const graph: FlowGraph = buildDevPayrollGraph(body.asset);
    const v = validateFlow(graph);
    if (!v.ok) {
      throw new AppError(
        "VALIDATION",
        "Generated payroll flow is invalid",
        Object.fromEntries(v.errors.map((e) => [e.path, [e.message]])),
      );
    }

    const pipeline = flowToPipeline(v.graph, relayerAddress, relayerAddress);
    const deployNodes = await Promise.all(
      pipeline.map(async (node) => {
        const hash = stellarWasmHash(node.templateKind);
        if (!hash) {
          throw new AppError(
            "VALIDATION",
            `No WASM uploaded for ${node.templateKind} on ${network}. Run pnpm contracts:upload --network=${network}.`,
          );
        }
        return {
          nodeId: node.nodeId,
          templateKind: node.templateKind,
          wasmHash: hash,
          params: node.params,
        };
      }),
    );

    const sourceAccount = relayerAddress;

    const flow = await db.flow.create({
      data: {
        ownerId,
        name: "Dev payroll (API)",
        description: "Auto-created by POST /api/deployments/dev-payroll",
        templateKind: "PAYROLL",
        graph: graph as object,
        parameters: pipeline as object,
      },
    });

    let deployment;
    try {
      deployment = await db.deployment.create({
        data: {
          flowId: flow.id,
          ownerId,
          network,
          status: "BUILDING",
          graphSnapshot: graph as object,
          paramsSnapshot: pipeline as object,
          sourceAccount,
          idempotencyKey,
        },
      });
    } catch (e) {
      // Concurrent request with the same key won the unique constraint — return
      // the deployment it created rather than deploying a second time.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        idempotencyKey
      ) {
        const existing = await db.deployment.findUnique({ where: { idempotencyKey } });
        if (existing) return NextResponse.json({ data: serializeDeployment(existing) });
      }
      throw e;
    }

    // startTs is derived from the pipeline params (not the on-chain result), so
    // compute it up front — it is needed on both the success and recovery paths.
    const scheduleNode = pipeline.find(
      (n): n is typeof n & { params: { kind: "subscription_dev_trigger"; startTs: number } } =>
        n.params.kind === "subscription_dev_trigger",
    );
    const startTs = scheduleNode?.params.startTs ?? Math.floor(Date.now() / 1000);
    const nextChargeAt = new Date(Math.max(startTs, Math.floor(Date.now() / 1000)) * 1000);

    let prepared: PreparedPipelineDeploy | undefined;
    let result: SubmitResult | undefined;
    try {
      // Serialize prepare + submit under the relayer lock: preparePipelineDeployTx
      // fetches the relayer's sequence number and submitDeployTxByRelayer consumes
      // it, so concurrent deploys (or a cron job) would otherwise race to txBadSeq.
      await withRelayerLock(async () => {
        prepared = await preparePipelineDeployTx({
          sourceAccount,
          graph,
          nodes: deployNodes,
        });
        result = await submitDeployTxByRelayer(prepared.xdr);
      });

      const triggerNode = prepared!.pipeline[0];
      const subscriptionContractAddress = triggerNode?.contractAddress ?? null;
      const splitterNode = prepared!.pipeline.find((p) => p.templateKind === "SPLITTER_DEV");
      const splitterContractAddress = splitterNode?.contractAddress ?? null;

      if (result!.status !== "SUCCESS") {
        await db.deployment.update({
          where: { id: deployment.id },
          data: {
            status: "FAILED",
            deployTxHash: result!.txHash,
            unsignedXdr: prepared!.xdr,
            contractAddress: subscriptionContractAddress,
            pipelineSnapshot: prepared!.pipeline as object,
            errorMessage: result!.errorMessage,
          },
        });
        await audit({
          action: "DEPLOY_FAIL",
          userId: user?.id ?? null,
          metadata: { deploymentId: deployment.id, error: result!.errorMessage },
        });
        return NextResponse.json(
          {
            error: {
              code: "UPSTREAM_RPC",
              message: result!.errorMessage ?? "Deployment failed",
            },
          },
          { status: 502 },
        );
      }

      const pipelineSnapshot = prepared!.pipeline as PipelineSnapshotEntry[];

      await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: "CONFIRMED",
          deployTxHash: result!.txHash,
          unsignedXdr: prepared!.xdr,
          contractAddress: subscriptionContractAddress,
          pipelineSnapshot: prepared!.pipeline as object,
          confirmedAt: new Date(),
          chargeRelayerMode: ChargeRelayerMode.PLATFORM,
          chargeRelayerAddress: relayerAddress,
          nextChargeAt,
        },
      });

      await audit({
        action: "DEPLOY_CONFIRM",
        userId: user?.id ?? null,
        metadata: {
          deploymentId: deployment.id,
          txHash: result!.txHash,
          subscriptionContractAddress,
          splitterContractAddress,
        },
      });

      return NextResponse.json({
        data: {
          deploymentId: deployment.id,
          txHash: result!.txHash,
          subscriptionContractAddress,
          splitterContractAddress,
          pipeline: pipelineSnapshot,
        },
      });
    } catch (err) {
      // If the on-chain tx already succeeded, the relayer has spent funds and the
      // contracts are live — never record that as FAILED. Persist it as CONFIRMED
      // with the real tx hash and flag the bookkeeping failure so it can be reconciled.
      if (result?.status === "SUCCESS") {
        const subscriptionContractAddress = prepared?.pipeline[0]?.contractAddress ?? null;
        await db.deployment.update({
          where: { id: deployment.id },
          data: {
            status: "CONFIRMED",
            deployTxHash: result.txHash,
            unsignedXdr: prepared?.xdr,
            contractAddress: subscriptionContractAddress,
            pipelineSnapshot: (prepared?.pipeline ?? []) as object,
            confirmedAt: new Date(),
            chargeRelayerMode: ChargeRelayerMode.PLATFORM,
            chargeRelayerAddress: relayerAddress,
            nextChargeAt,
            errorMessage: `Deploy succeeded on-chain (tx ${result.txHash}) but post-deploy bookkeeping failed: ${(err as Error).message}`,
          },
        });
        await audit({
          action: "DEPLOY_CONFIRM",
          userId: user?.id ?? null,
          metadata: {
            deploymentId: deployment.id,
            txHash: result.txHash,
            bookkeepingError: (err as Error).message,
          },
        });
        throw err;
      }
      await db.deployment.update({
        where: { id: deployment.id },
        data: { status: "FAILED", errorMessage: (err as Error).message },
      });
      await audit({
        action: "DEPLOY_FAIL",
        userId: user?.id ?? null,
        metadata: { deploymentId: deployment.id, error: (err as Error).message },
      });
      throw err;
    }
  });
}

function serializeDeployment(d: {
  id: string;
  deployTxHash: string | null;
  contractAddress: string | null;
  pipelineSnapshot: unknown;
}) {
  const pipeline = (
    Array.isArray(d.pipelineSnapshot) ? d.pipelineSnapshot : []
  ) as PipelineSnapshotEntry[];
  const splitter = pipeline.find((p) => p.templateKind === "SPLITTER_DEV");
  return {
    deploymentId: d.id,
    txHash: d.deployTxHash,
    subscriptionContractAddress: d.contractAddress,
    splitterContractAddress: splitter?.contractAddress ?? null,
    pipeline,
  };
}

function buildDevPayrollGraph(asset: Asset): FlowGraph {
  const triggerId = "payroll-trigger";
  const splitId = "payroll-split";
  return {
    devMode: true,
    nodes: [
      {
        id: triggerId,
        type: "payroll",
        config: {
          asset,
          employer: "PENDING:employer",
          intervalAmount: 1,
          intervalUnit: "week",
          fillScheduleViaApi: true,
        },
      },
      {
        id: splitId,
        type: "split",
        config: {
          asset,
          recipients: [],
        },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: triggerId,
        target: splitId,
      },
    ],
  };
}
