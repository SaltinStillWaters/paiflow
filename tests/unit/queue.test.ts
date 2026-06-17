import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeNextBackoff, BACKOFF_STEPS } from "@/lib/workers/poll-deployment-events";
import { schedulePoll, POLL_JOB_NAME, POLL_JOB_ID } from "@/lib/queue-utils";

vi.mock("@/lib/queue", () => ({
  getQueue: vi.fn(),
  POLL_DEPLOYMENT_EVENTS_QUEUE: "poll-deployment-events",
}));

vi.mock("@/lib/db", () => ({
  db: {
    pollState: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { getQueue } from "@/lib/queue";
import { db } from "@/lib/db";

describe("computeNextBackoff", () => {
  it("resets to 5s delay and 10s backoff when events are found", () => {
    const result = computeNextBackoff(300, 3);
    expect(result.backoffSeconds).toBe(BACKOFF_STEPS[0]);
    expect(result.delayMs).toBe(5000);
  });

  it("climbs the backoff ladder when no events are found", () => {
    expect(computeNextBackoff(10, 0)).toEqual({ backoffSeconds: 30, delayMs: 10_000 });
    expect(computeNextBackoff(30, 0)).toEqual({ backoffSeconds: 60, delayMs: 30_000 });
    expect(computeNextBackoff(60, 0)).toEqual({ backoffSeconds: 300, delayMs: 60_000 });
  });

  it("stays at the 5-minute ceiling", () => {
    expect(computeNextBackoff(300, 0)).toEqual({ backoffSeconds: 300, delayMs: 300_000 });
  });
});

describe("schedulePoll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when the queue is unavailable", async () => {
    vi.mocked(getQueue).mockReturnValue(null);
    await schedulePoll("dep-1", 5000, true);
    expect(db.pollState.upsert).not.toHaveBeenCalled();
  });

  it("adds a delayed job with a stable jobId", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getQueue).mockReturnValue({ add } as unknown as ReturnType<typeof getQueue>);

    await schedulePoll("dep-1", 5000);

    expect(add).toHaveBeenCalledWith(
      POLL_JOB_NAME,
      { deploymentId: "dep-1" },
      { delay: 5000, jobId: POLL_JOB_ID("dep-1") },
    );
  });

  it("rounds fractional delays", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getQueue).mockReturnValue({ add } as unknown as ReturnType<typeof getQueue>);

    await schedulePoll("dep-1", 5000.7);

    expect(add).toHaveBeenCalledWith(
      POLL_JOB_NAME,
      { deploymentId: "dep-1" },
      { delay: 5001, jobId: POLL_JOB_ID("dep-1") },
    );
  });

  it("resets backoff state when resetBackoff is true", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getQueue).mockReturnValue({ add } as unknown as ReturnType<typeof getQueue>);

    await schedulePoll("dep-1", 5000, true);

    expect(db.pollState.upsert).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1" },
      update: { backoffSeconds: 10 },
      create: { deploymentId: "dep-1", backoffSeconds: 10 },
    });
  });
});
