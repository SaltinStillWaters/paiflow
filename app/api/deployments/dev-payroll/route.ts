import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { env, devDeployOwnerId, stellarRelayerAddress, stellarWasmHash } from "@/lib/env";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { preparePipelineDeployTx, submitDeployTxByRelayer } from "@/lib/stellar/deploy";
import { ChargeRelayerMode } from "@prisma/client";
import type { FlowGraph, Asset } from "@/lib/flows/schema";

const AssetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({ kind: z.literal("known"), symbol: z.enum(["USDC"]) }),
  z.object({
    kind: z.literal("custom"),
    code: z.string().min(1).max(12),
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
    const { user } = await requireDevAuth(req);
    const rlKey = user ? `dev-deploy:${user.id}` : `dev-deploy:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 10, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many dev payroll deploys");

    const body = BodySchema.parse(await req.json());
    const ownerId = user?.id ?? devDeployOwnerId();
    if (!ownerId) {
      throw new AppError(
        "INTERNAL",
        "DEV_DEPLOY_OWNER_ID is required for machine-auth payroll deploy",
      );
    }

    const network = env().STELLAR_NETWORK;
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

    const deployment = await db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId,
        network,
        status: "BUILDING",
        graphSnapshot: graph as object,
        paramsSnapshot: pipeline as object,
        sourceAccount,
      },
    });

    try {
      const prepared = await preparePipelineDeployTx({
        sourceAccount,
        graph,
        nodes: deployNodes,
      });

      const triggerNode = prepared.pipeline[0];
      const subscriptionContractAddress = triggerNode?.contractAddress ?? null;
      const splitterNode = prepared.pipeline.find((p) => p.templateKind === "SPLITTER_DEV");
      const splitterContractAddress = splitterNode?.contractAddress ?? null;

      await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: "PENDING_SIGNATURE",
          unsignedXdr: prepared.xdr,
          contractAddress: subscriptionContractAddress,
          pipelineSnapshot: prepared.pipeline as object,
        },
      });

      const result = await submitDeployTxByRelayer(prepared.xdr);

      if (result.status !== "SUCCESS") {
        await db.deployment.update({
          where: { id: deployment.id },
          data: {
            status: "FAILED",
            deployTxHash: result.txHash,
            errorMessage: result.errorMessage,
          },
        });
        await audit({
          action: "DEPLOY_FAIL",
          userId: user?.id ?? null,
          metadata: { deploymentId: deployment.id, error: result.errorMessage },
        });
        return NextResponse.json(
          {
            error: {
              code: "UPSTREAM_RPC",
              message: result.errorMessage ?? "Deployment failed",
            },
          },
          { status: 502 },
        );
      }

      const pipelineSnapshot = prepared.pipeline as PipelineSnapshotEntry[];
      const scheduleNode = pipeline.find(
        (n): n is typeof n & { params: { kind: "subscription_dev_trigger"; startTs: number } } =>
          n.params.kind === "subscription_dev_trigger",
      );
      const startTs = scheduleNode?.params.startTs ?? Math.floor(Date.now() / 1000);

      await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: "CONFIRMED",
          deployTxHash: result.txHash,
          contractAddress: subscriptionContractAddress,
          confirmedAt: new Date(),
          chargeRelayerMode: ChargeRelayerMode.PLATFORM,
          chargeRelayerAddress: relayerAddress,
          nextChargeAt: new Date(Math.max(startTs, Math.floor(Date.now() / 1000)) * 1000),
        },
      });

      await audit({
        action: "DEPLOY_CONFIRM",
        userId: user?.id ?? null,
        metadata: {
          deploymentId: deployment.id,
          txHash: result.txHash,
          subscriptionContractAddress,
          splitterContractAddress,
        },
      });

      return NextResponse.json({
        data: {
          deploymentId: deployment.id,
          txHash: result.txHash,
          subscriptionContractAddress,
          splitterContractAddress,
          pipeline: pipelineSnapshot,
        },
      });
    } catch (err) {
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
