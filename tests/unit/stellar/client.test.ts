import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedis = {
  set: vi.fn(),
  eval: vi.fn(),
};

vi.mock("@/lib/redis", () => ({ redis: () => mockRedis }));
vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent" }),
  stellarRelayerAddress: () => "GRELAYER",
}));

import { withRelayerLock } from "@/lib/stellar/client";

describe("withRelayerLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockResolvedValue(1);
  });

  it("acquires and releases a Redis distributed lock when Redis is configured", async () => {
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withRelayerLock(fn);

    expect(result).toBe("result");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "relayer-lock:GRELAYER",
      expect.any(String),
      "PX",
      90_000,
      "NX",
    );
    expect(mockRedis.eval).toHaveBeenCalled();
    expect(fn).toHaveBeenCalled();
  });

  it("releases the lock even if the guarded function throws", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withRelayerLock(fn)).rejects.toThrow("boom");

    expect(mockRedis.eval).toHaveBeenCalled();
  });
});
