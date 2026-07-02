import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChargeRelayerMode } from "@prisma/client";

const { mockDb, mockEnv, mockAuth, mockDeploy, mockRateLimit, mockClient } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb)),
    flow: {
      create: vi.fn(),
    },
    deployment: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
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

  const mockClient = {
    withRelayerLock: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };

  return { mockDb, mockEnv, mockAuth, mockDeploy, mockRateLimit, mockClient };
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
vi.mock("@/lib/stellar/client", () => mockClient);

import { POST } from "@/app/api/deployments/dev-payroll/route";
import { hashIdempotencyPayload } from "@/app/api/deployments/dev-payroll/route";

function makeRequest({
  asset = { kind: "known", symbol: "USDC" } as const,
  secret = "dev-secret",
  idempotencyKey,
}: {
  asset?: { kind: "known"; symbol: "USDC" } | Record<string, unknown>;
  secret?: string;
  idempotencyKey?: string;
} = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret) headers["x-dev-api-secret"] = secret;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return {
    headers: {
      get: (name: string) => headers[name] ?? null,
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
    mockDb.deployment.findUnique.mockResolvedValue(null);
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

    expect(mockClient.withRelayerLock).toHaveBeenCalled();
    expect(mockDeploy.preparePipelineDeployTx).toHaveBeenCalled();
    expect(mockDeploy.submitDeployTxByRelayer).toHaveBeenCalledWith("AAAA...");

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
          idempotencyPayload: expect.any(String),
        }),
      }),
    );

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

  it("rejects custom asset codes with invalid characters", async () => {
    const req = makeRequest({
      asset: { kind: "custom", code: "USDC!", issuer: "G".padEnd(56, "A") },
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

  it("wraps prepare + submit in the relayer lock", async () => {
    const calls: string[] = [];
    mockClient.withRelayerLock.mockImplementation(async (fn: () => Promise<unknown>) => {
      calls.push("lock-start");
      const result = await fn();
      calls.push("lock-end");
      return result;
    });
    mockDeploy.preparePipelineDeployTx.mockImplementation(async () => {
      calls.push("prepare");
      return {
        xdr: "AAAA...",
        pipeline: [
          {
            nodeId: "payroll-trigger",
            contractAddress: "CSUBSCRIPTION",
            templateKind: "SUBSCRIPTION_DEV",
            salt: Buffer.alloc(32),
          },
        ],
      };
    });
    mockDeploy.submitDeployTxByRelayer.mockImplementation(async () => {
      calls.push("submit");
      return { status: "SUCCESS", txHash: "tx-deploy" };
    });

    await POST(makeRequest({}));

    expect(calls).toEqual(["lock-start", "prepare", "submit", "lock-end"]);
  });

  it("records CONFIRMED (not FAILED) when on-chain deploy succeeds but bookkeeping throws", async () => {
    mockDb.deployment.update.mockRejectedValueOnce(new Error("DB is down"));

    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.code).toBe("INTERNAL");

    const calls = mockDb.deployment.update.mock.calls as [
      { where: { id: string }; data: Record<string, unknown> },
    ][];
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall![0].data.status).toBe("CONFIRMED");
    expect(lastCall![0].data.deployTxHash).toBe("tx-deploy");
    expect(lastCall![0].data.errorMessage).toContain("bookkeeping failed");
  });

  it("returns existing deployment for a reused idempotency key", async () => {
    const key = "idem-abc-123";
    mockDb.deployment.findUnique.mockResolvedValue({
      id: "dep-existing",
      deployTxHash: "tx-existing",
      contractAddress: "CEXISTING",
      idempotencyPayload: hashIdempotencyPayload({ kind: "known", symbol: "USDC" }),
      pipelineSnapshot: [
        {
          nodeId: "payroll-trigger",
          contractAddress: "CEXISTING",
          templateKind: "SUBSCRIPTION_DEV",
          salt: Buffer.alloc(32),
        },
      ],
    });

    const req = makeRequest({ idempotencyKey: key });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deploymentId).toBe("dep-existing");
    expect(json.data.txHash).toBe("tx-existing");
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });

  it("returns 409 when an idempotency key is reused with a different asset", async () => {
    const key = "idem-mismatch";
    mockDb.deployment.findUnique.mockResolvedValue({
      id: "dep-existing",
      deployTxHash: "tx-existing",
      contractAddress: "CEXISTING",
      idempotencyPayload: hashIdempotencyPayload({ kind: "native" }),
      pipelineSnapshot: [
        {
          nodeId: "payroll-trigger",
          contractAddress: "CEXISTING",
          templateKind: "SUBSCRIPTION_DEV",
          salt: Buffer.alloc(32),
        },
      ],
    });

    const req = makeRequest({ idempotencyKey: key });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("CONFLICT");
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });

  it("returns the winner's deployment on a concurrent idempotency-key race", async () => {
    const key = "idem-race";
    mockDb.deployment.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on idempotencyKey"), { code: "P2002" }),
    );
    mockDb.deployment.findUnique.mockResolvedValue({
      id: "dep-winner",
      deployTxHash: "tx-winner",
      contractAddress: "CWINNER",
      idempotencyPayload: hashIdempotencyPayload({ kind: "known", symbol: "USDC" }),
      pipelineSnapshot: [
        {
          nodeId: "payroll-trigger",
          contractAddress: "CWINNER",
          templateKind: "SUBSCRIPTION_DEV",
          salt: Buffer.alloc(32),
        },
      ],
    });

    const req = makeRequest({ idempotencyKey: key });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deploymentId).toBe("dep-winner");
  });

  it("blocks deploy on mainnet", async () => {
    mockEnv.STELLAR_NETWORK = "mainnet";
    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
    mockEnv.STELLAR_NETWORK = "testnet";
  });

  it("requires ADMIN when falling back to session auth", async () => {
    (mockAuth.requireDevAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", username: "alice", role: "USER" },
    });

    const req = makeRequest({ secret: "" });
    await POST(req);

    expect(mockAuth.requireDevAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "ADMIN" }),
    );
  });
});
