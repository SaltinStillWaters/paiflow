import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChargeRelayerMode } from "@prisma/client";

const { mockDb, mockEnv, mockAuth, mockDeploy, mockRateLimit } = vi.hoisted(() => {
  const mockDb = {
    flow: {
      create: vi.fn(),
    },
    deployment: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  const mockEnv = {
    STELLAR_NETWORK: "testnet",
    LOG_LEVEL: "silent",
    DEV_API_SECRET: "dev-secret",
    DEV_DEPLOY_OWNER_ID: "00000000-0000-0000-0000-000000000000",
    STELLAR_RELAYER_ADDRESS: "GRELAYER",
  };

  const mockAuth = {
    requireDevAuth: vi.fn(async () => ({ user: null })),
  };

  const mockDeploy = {
    preparePipelineDeployTx: vi.fn(),
    submitDeployTxByRelayer: vi.fn(),
  };

  const mockRateLimit = {
    rateLimit: vi.fn(async () => ({ ok: true })),
    clientIp: vi.fn(() => "127.0.0.1"),
  };

  return { mockDb, mockEnv, mockAuth, mockDeploy, mockRateLimit };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({
  env: () => mockEnv,
  devDeployOwnerId: () => mockEnv.DEV_DEPLOY_OWNER_ID,
  stellarRelayerAddress: () => mockEnv.STELLAR_RELAYER_ADDRESS,
  stellarWasmHash: () => "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
}));
vi.mock("@/lib/auth", () => mockAuth);
vi.mock("@/lib/rate-limit", () => mockRateLimit);
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/deploy", () => mockDeploy);

import { POST } from "@/app/api/deployments/dev-payroll/route";

function makeRequest({
  asset = { kind: "known", symbol: "USDC" } as const,
  secret = "dev-secret",
}) {
  return {
    headers: {
      get: (name: string) =>
        name === "x-dev-api-secret" ? secret : name === "content-type" ? "application/json" : null,
    },
    json: async () => ({ asset }),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/deployments/dev-payroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.flow.create.mockResolvedValue({ id: "flow-1" });
    mockDb.deployment.create.mockResolvedValue({ id: "dep-1" });
    mockDb.deployment.update.mockResolvedValue({ id: "dep-1" });
    mockDeploy.preparePipelineDeployTx.mockResolvedValue({
      xdr: "AAAA...",
      pipeline: [
        {
          nodeId: "payroll-trigger",
          contractAddress: "CSUBSCRIPTION",
          templateKind: "SUBSCRIPTION_DEV",
          salt: Buffer.alloc(32),
        },
        {
          nodeId: "payroll-split",
          contractAddress: "CSPLITTER",
          templateKind: "SPLITTER_DEV",
          salt: Buffer.alloc(32),
        },
      ],
    });
    mockDeploy.submitDeployTxByRelayer.mockResolvedValue({
      status: "SUCCESS",
      txHash: "tx-deploy",
    });
  });

  it("deploys a dev-mode payroll pipeline and returns both contract addresses", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deploymentId).toBe("dep-1");
    expect(json.data.txHash).toBe("tx-deploy");
    expect(json.data.subscriptionContractAddress).toBe("CSUBSCRIPTION");
    expect(json.data.splitterContractAddress).toBe("CSPLITTER");
    expect(json.data.pipeline).toHaveLength(2);

    expect(mockDb.flow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "00000000-0000-0000-0000-000000000000",
          templateKind: "PAYROLL",
        }),
      }),
    );

    expect(mockDb.deployment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flowId: "flow-1",
          ownerId: "00000000-0000-0000-0000-000000000000",
          network: "testnet",
          status: "BUILDING",
          sourceAccount: "GRELAYER",
        }),
      }),
    );

    expect(mockDeploy.preparePipelineDeployTx).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccount: "GRELAYER",
      }),
    );
    expect(mockDeploy.submitDeployTxByRelayer).toHaveBeenCalledWith("AAAA...");

    expect(mockDb.deployment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "dep-1" },
        data: expect.objectContaining({
          status: "CONFIRMED",
          deployTxHash: "tx-deploy",
          contractAddress: "CSUBSCRIPTION",
          chargeRelayerMode: ChargeRelayerMode.PLATFORM,
          chargeRelayerAddress: "GRELAYER",
        }),
      }),
    );
  });

  it("rejects invalid assets", async () => {
    const req = makeRequest({
      asset: { kind: "known", symbol: "BTC" } as unknown as { kind: "known"; symbol: "USDC" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION");
  });

  it("returns upstream error when relayer submission fails", async () => {
    mockDeploy.submitDeployTxByRelayer.mockResolvedValue({
      status: "FAILED",
      txHash: "tx-fail",
      errorMessage: "simulate failed",
    });

    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error.code).toBe("UPSTREAM_RPC");
  });
});
