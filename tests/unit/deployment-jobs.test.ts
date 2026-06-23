import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { DeploymentFinalizeJobStatus, DeploymentStatus } from "@prisma/client";
import {
  scheduleDeploymentFinalizeJob,
  getDueDeploymentFinalizeJobs,
  rescheduleDeploymentFinalizeJob,
  cancelPendingDeploymentFinalizeJobs,
} from "@/lib/deployment-jobs";

describe("deployment-jobs", () => {
  beforeEach(async () => {
    await db.deploymentFinalizeJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(async () => {
    await db.deploymentFinalizeJob.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  async function makeDeployment(status: DeploymentStatus = "SUBMITTED") {
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
        status,
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
  }

  describe("scheduleDeploymentFinalizeJob", () => {
    it("creates a pending job 5 minutes after submittedAt", async () => {
      const deployment = await makeDeployment();
      const submittedAt = new Date("2030-01-01T00:00:00Z");

      const result = await scheduleDeploymentFinalizeJob(db, deployment.id, submittedAt);

      expect(result).not.toBeNull();
      expect(result!.runAt).toEqual(new Date("2030-01-01T00:05:00Z"));

      const job = await db.deploymentFinalizeJob.findUnique({ where: { id: result!.id } });
      expect(job).toMatchObject({
        deploymentId: deployment.id,
        status: DeploymentFinalizeJobStatus.PENDING,
      });
    });

    it("does not duplicate active jobs", async () => {
      const deployment = await makeDeployment();
      const submittedAt = new Date("2030-01-01T00:00:00Z");

      const first = await scheduleDeploymentFinalizeJob(db, deployment.id, submittedAt);
      const second = await scheduleDeploymentFinalizeJob(db, deployment.id, submittedAt);

      expect(second!.id).toEqual(first!.id);
      const count = await db.deploymentFinalizeJob.count();
      expect(count).toEqual(1);
    });

    it("allows a new job after the previous one is terminal", async () => {
      const deployment = await makeDeployment();
      const submittedAt = new Date("2030-01-01T00:00:00Z");

      const first = await scheduleDeploymentFinalizeJob(db, deployment.id, submittedAt);
      await db.deploymentFinalizeJob.update({
        where: { id: first!.id },
        data: { status: DeploymentFinalizeJobStatus.FINALIZED },
      });

      const second = await scheduleDeploymentFinalizeJob(
        db,
        deployment.id,
        new Date(submittedAt.getTime() + 1),
      );

      expect(second!.id).not.toEqual(first!.id);
    });
  });

  describe("getDueDeploymentFinalizeJobs", () => {
    it("returns only pending jobs at or past runAt", async () => {
      const deployment = await makeDeployment();
      const now = new Date("2024-01-01T00:00:00Z");

      const dueJob = await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: now,
          status: DeploymentFinalizeJobStatus.PENDING,
        },
      });

      await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date("2030-01-01T00:00:00Z"),
          status: DeploymentFinalizeJobStatus.PENDING,
        },
      });

      await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date("2023-01-01T00:00:00Z"),
          status: DeploymentFinalizeJobStatus.FINALIZED,
        },
      });

      const jobs = await getDueDeploymentFinalizeJobs(db, 50);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).toEqual(dueJob.id);
    });
  });

  describe("cancelPendingDeploymentFinalizeJobs", () => {
    it("cancels pending and running jobs for a deployment", async () => {
      const deployment = await makeDeployment();

      const pending = await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date(),
          status: DeploymentFinalizeJobStatus.PENDING,
        },
      });

      const running = await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date(),
          status: DeploymentFinalizeJobStatus.RUNNING,
        },
      });

      await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date(),
          status: DeploymentFinalizeJobStatus.FINALIZED,
        },
      });

      const cancelled = await cancelPendingDeploymentFinalizeJobs(db, deployment.id);
      expect(cancelled).toEqual(2);

      const updatedPending = await db.deploymentFinalizeJob.findUnique({
        where: { id: pending.id },
      });
      const updatedRunning = await db.deploymentFinalizeJob.findUnique({
        where: { id: running.id },
      });
      expect(updatedPending?.status).toEqual(DeploymentFinalizeJobStatus.CANCELLED);
      expect(updatedRunning?.status).toEqual(DeploymentFinalizeJobStatus.CANCELLED);
    });
  });

  describe("rescheduleDeploymentFinalizeJob", () => {
    it("updates status and lastError", async () => {
      const deployment = await makeDeployment();
      const job = await db.deploymentFinalizeJob.create({
        data: {
          deploymentId: deployment.id,
          runAt: new Date(),
          status: DeploymentFinalizeJobStatus.PENDING,
        },
      });

      await rescheduleDeploymentFinalizeJob(db, job.id, {
        status: DeploymentFinalizeJobStatus.RUNNING,
        lastError: "test error",
      });

      const updated = await db.deploymentFinalizeJob.findUnique({ where: { id: job.id } });
      expect(updated?.status).toEqual(DeploymentFinalizeJobStatus.RUNNING);
      expect(updated?.lastError).toEqual("test error");
    });
  });
});
