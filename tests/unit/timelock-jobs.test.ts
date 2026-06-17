import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { TimelockReleaseJobStatus } from "@prisma/client";
import {
  computeTimelockRunAt,
  scheduleTimelockReleaseJob,
  getDueTimelockJobs,
  rescheduleTimelockJob,
  cancelPendingTimelockJobs,
  resetStaleRunningTimelockJobs,
} from "@/lib/timelock-jobs";

describe("computeTimelockRunAt", () => {
  it("returns unlockTime for after mode when in the future", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const unlockTime = Math.floor(now.getTime() / 1000) + 3600;
    const result = computeTimelockRunAt(unlockTime, "after", now);
    expect(result).toEqual(new Date(unlockTime * 1000));
  });

  it("returns now for after mode when unlockTime is in the past", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const unlockTime = Math.floor(now.getTime() / 1000) - 3600;
    const result = computeTimelockRunAt(unlockTime, "after", now);
    expect(result).toEqual(now);
  });

  it("returns one minute before unlockTime for before mode when far in the future", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const unlockTime = Math.floor(now.getTime() / 1000) + 3600;
    const result = computeTimelockRunAt(unlockTime, "before", now);
    expect(result).toEqual(new Date(unlockTime * 1000 - 60_000));
  });

  it("returns now for before mode when unlockTime is within the buffer", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const unlockTime = Math.floor(now.getTime() / 1000) + 30;
    const result = computeTimelockRunAt(unlockTime, "before", now);
    expect(result).toEqual(now);
  });
});

describe("scheduleTimelockReleaseJob", () => {
  beforeEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "TIMELOCK",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("creates a pending job at unlockTime for after mode", async () => {
    const deployment = await makeDeployment();
    const nowSec = Math.floor(Date.now() / 1000);
    const params = { unlockTime: nowSec + 3600, mode: "after" as const };

    const result = await scheduleTimelockReleaseJob(db, deployment.id, "node-1", "C123", params);

    expect(result).not.toBeNull();
    expect(result!.runAt).toEqual(new Date(params.unlockTime * 1000));

    const job = await db.timelockReleaseJob.findUnique({ where: { id: result!.id } });
    expect(job).toMatchObject({
      deploymentId: deployment.id,
      nodeId: "node-1",
      contractAddress: "C123",
      status: TimelockReleaseJobStatus.PENDING,
    });
  });

  it("creates a pending job one minute before unlockTime for before mode", async () => {
    const deployment = await makeDeployment();
    const nowSec = Math.floor(Date.now() / 1000);
    const params = { unlockTime: nowSec + 3600, mode: "before" as const };

    const result = await scheduleTimelockReleaseJob(db, deployment.id, "node-1", "C123", params);

    expect(result).not.toBeNull();
    expect(result!.runAt).toEqual(new Date(params.unlockTime * 1000 - 60_000));

    const job = await db.timelockReleaseJob.findUnique({ where: { id: result!.id } });
    expect(job).toMatchObject({
      deploymentId: deployment.id,
      nodeId: "node-1",
      contractAddress: "C123",
      status: TimelockReleaseJobStatus.PENDING,
    });
  });

  it("does not create a duplicate active job", async () => {
    const deployment = await makeDeployment();
    const params = { unlockTime: Math.floor(Date.now() / 1000) + 3600, mode: "after" as const };

    const first = await scheduleTimelockReleaseJob(db, deployment.id, "node-1", "C123", params);
    const second = await scheduleTimelockReleaseJob(db, deployment.id, "node-1", "C123", params);

    expect(second!.id).toBe(first!.id);

    const count = await db.timelockReleaseJob.count({ where: { deploymentId: deployment.id } });
    expect(count).toBe(1);
  });

  it("creates a new job after the previous one is terminal", async () => {
    const deployment = await makeDeployment();
    const params = { unlockTime: Math.floor(Date.now() / 1000) + 3600, mode: "after" as const };

    const first = await scheduleTimelockReleaseJob(db, deployment.id, "node-1", "C123", params);
    await rescheduleTimelockJob(db, first!.id, { status: TimelockReleaseJobStatus.RELEASED });

    const second = await scheduleTimelockReleaseJob(db, deployment.id, "node-1", "C123", params);
    expect(second!.id).not.toBe(first!.id);
  });
});

describe("getDueTimelockJobs", () => {
  beforeEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "TIMELOCK",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("returns only pending jobs that are due", async () => {
    const deployment = await makeDeployment();
    const now = new Date();

    const due = await db.timelockReleaseJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "due",
        contractAddress: "C1",
        runAt: new Date(now.getTime() - 60_000),
        status: TimelockReleaseJobStatus.PENDING,
      },
    });

    await db.timelockReleaseJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "future",
        contractAddress: "C2",
        runAt: new Date(now.getTime() + 60_000),
        status: TimelockReleaseJobStatus.PENDING,
      },
    });

    await db.timelockReleaseJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "running",
        contractAddress: "C3",
        runAt: new Date(now.getTime() - 60_000),
        status: TimelockReleaseJobStatus.RUNNING,
      },
    });

    const jobs = await getDueTimelockJobs(db, 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(due.id);
  });
});

describe("cancelPendingTimelockJobs", () => {
  beforeEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "TIMELOCK",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("cancels pending and running jobs for a deployment", async () => {
    const deployment = await makeDeployment();
    const base = {
      deploymentId: deployment.id,
      contractAddress: "C1",
      runAt: new Date(),
    };

    await db.timelockReleaseJob.create({
      data: { ...base, nodeId: "p1", status: TimelockReleaseJobStatus.PENDING },
    });
    await db.timelockReleaseJob.create({
      data: { ...base, nodeId: "r1", status: TimelockReleaseJobStatus.RUNNING },
    });
    await db.timelockReleaseJob.create({
      data: { ...base, nodeId: "c1", status: TimelockReleaseJobStatus.RELEASED },
    });

    const count = await cancelPendingTimelockJobs(db, deployment.id);
    expect(count).toBe(2);

    const jobs = await db.timelockReleaseJob.findMany({
      where: { deploymentId: deployment.id },
    });

    const statuses = new Map(jobs.map((j) => [j.nodeId, j.status]));
    expect(statuses.get("p1")).toBe(TimelockReleaseJobStatus.CANCELLED);
    expect(statuses.get("r1")).toBe(TimelockReleaseJobStatus.CANCELLED);
    expect(statuses.get("c1")).toBe(TimelockReleaseJobStatus.RELEASED);
  });
});

describe("resetStaleRunningTimelockJobs", () => {
  beforeEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(async () => {
    await db.timelockReleaseJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  async function makeDeployment() {
    const user = await db.user.create({
      data: {
        username: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "hash",
      },
    });
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: "test",
        templateKind: "TIMELOCK",
        graph: {},
        parameters: {},
      },
    });
    return db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  it("resets stale RUNNING jobs back to PENDING", async () => {
    const deployment = await makeDeployment();
    const now = new Date();
    const stale = new Date(now.getTime() - 11 * 60 * 1_000);

    const job = await db.timelockReleaseJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "stale",
        contractAddress: "C1",
        runAt: new Date(now.getTime() - 60_000),
        status: TimelockReleaseJobStatus.RUNNING,
        updatedAt: stale,
      },
    });

    await db.timelockReleaseJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "fresh",
        contractAddress: "C2",
        runAt: new Date(now.getTime() - 60_000),
        status: TimelockReleaseJobStatus.RUNNING,
        updatedAt: now,
      },
    });

    await db.timelockReleaseJob.create({
      data: {
        deploymentId: deployment.id,
        nodeId: "pending",
        contractAddress: "C3",
        runAt: new Date(now.getTime() - 60_000),
        status: TimelockReleaseJobStatus.PENDING,
        updatedAt: stale,
      },
    });

    const count = await resetStaleRunningTimelockJobs(db);
    expect(count).toBe(1);

    const updated = await db.timelockReleaseJob.findUnique({ where: { id: job.id } });
    expect(updated!.status).toBe(TimelockReleaseJobStatus.PENDING);
    expect(updated!.lastError).toBe("Reset from stale RUNNING state");

    const fresh = await db.timelockReleaseJob.findFirst({
      where: { deploymentId: deployment.id, nodeId: "fresh" },
    });
    expect(fresh!.status).toBe(TimelockReleaseJobStatus.RUNNING);

    const pending = await db.timelockReleaseJob.findFirst({
      where: { deploymentId: deployment.id, nodeId: "pending" },
    });
    expect(pending!.status).toBe(TimelockReleaseJobStatus.PENDING);
  });

  it("returns zero when there are no stale RUNNING jobs", async () => {
    const count = await resetStaleRunningTimelockJobs(db);
    expect(count).toBe(0);
  });
});
