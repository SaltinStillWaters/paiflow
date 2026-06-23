import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { EmailNotificationStatus } from "@prisma/client";
import {
  scheduleEmailNotification,
  getDueEmailNotifications,
  rescheduleEmailJob,
  cancelPendingEmailJobs,
  resetStaleRunningEmailJobs,
  STALE_RUNNING_EMAIL_JOB_TIMEOUT_MS,
} from "@/lib/email-jobs";

describe("email-jobs", () => {
  beforeEach(async () => {
    await db.emailNotification.deleteMany();
    await db.contractEvent.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(async () => {
    await db.emailNotification.deleteMany();
    await db.contractEvent.deleteMany();
    await db.deployment.deleteMany();
    await db.flow.deleteMany();
    await db.user.deleteMany();
  });

  async function makeDeploymentAndEvent() {
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
    const deployment = await db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
    const event = await db.contractEvent.create({
      data: {
        deploymentId: deployment.id,
        eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "RECEIVE",
        ledger: 1,
        txHash: "tx",
        payload: {},
        occurredAt: new Date(),
      },
    });
    return { deployment, event };
  }

  describe("scheduleEmailNotification", () => {
    it("creates a pending email notification job", async () => {
      const { deployment, event } = await makeDeploymentAndEvent();

      const result = await scheduleEmailNotification(db, {
        deploymentId: deployment.id,
        contractEventId: event.id,
        nodeId: "node-1",
        address: "G123",
        recipient: "test@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
        text: "Hello",
      });

      expect(result).not.toBeNull();
      const job = await db.emailNotification.findUnique({ where: { id: result!.id } });
      expect(job).toMatchObject({
        deploymentId: deployment.id,
        contractEventId: event.id,
        nodeId: "node-1",
        address: "G123",
        recipient: "test@example.com",
        subject: "Hello",
        status: EmailNotificationStatus.PENDING,
      });
    });

    it("is idempotent on (contractEventId, nodeId, address)", async () => {
      const { deployment, event } = await makeDeploymentAndEvent();

      const first = await scheduleEmailNotification(db, {
        deploymentId: deployment.id,
        contractEventId: event.id,
        nodeId: "node-1",
        address: "G123",
        recipient: "test@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
        text: "Hello",
      });

      const second = await scheduleEmailNotification(db, {
        deploymentId: deployment.id,
        contractEventId: event.id,
        nodeId: "node-1",
        address: "G123",
        recipient: "other@example.com",
        subject: "Other",
        html: "<p>Other</p>",
        text: "Other",
      });

      expect(second!.id).toEqual(first!.id);
      const count = await db.emailNotification.count();
      expect(count).toEqual(1);
    });
  });

  describe("getDueEmailNotifications", () => {
    it("returns only pending jobs at or past runAt", async () => {
      const { deployment, event } = await makeDeploymentAndEvent();
      const now = new Date("2024-01-01T00:00:00Z");

      const dueJob = await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-1",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.PENDING,
          runAt: now,
        },
      });

      await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-2",
          address: "G123",
          recipient: "future@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.PENDING,
          runAt: new Date("2030-01-01T00:00:00Z"),
        },
      });

      await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-3",
          address: "G123",
          recipient: "sent@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.SENT,
          runAt: new Date("2023-01-01T00:00:00Z"),
        },
      });

      const jobs = await getDueEmailNotifications(db, 50);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).toEqual(dueJob.id);
    });
  });

  describe("rescheduleEmailJob", () => {
    it("updates status, sentAt, and lastError", async () => {
      const { deployment, event } = await makeDeploymentAndEvent();
      const job = await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-1",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.PENDING,
          runAt: new Date(),
        },
      });

      const sentAt = new Date("2024-01-01T00:00:00Z");
      await rescheduleEmailJob(db, job.id, {
        status: EmailNotificationStatus.SENT,
        sentAt,
        lastError: null,
      });

      const updated = await db.emailNotification.findUnique({ where: { id: job.id } });
      expect(updated?.status).toEqual(EmailNotificationStatus.SENT);
      expect(updated?.sentAt).toEqual(sentAt);
      expect(updated?.lastError).toBeNull();
    });
  });

  describe("cancelPendingEmailJobs", () => {
    it("cancels pending and running jobs for a deployment", async () => {
      const { deployment, event } = await makeDeploymentAndEvent();

      const pending = await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-1",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.PENDING,
          runAt: new Date(),
        },
      });

      const running = await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-2",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.RUNNING,
          runAt: new Date(),
        },
      });

      await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-3",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.SENT,
          runAt: new Date(),
        },
      });

      const cancelled = await cancelPendingEmailJobs(db, deployment.id);
      expect(cancelled).toEqual(2);

      const updatedPending = await db.emailNotification.findUnique({ where: { id: pending.id } });
      const updatedRunning = await db.emailNotification.findUnique({ where: { id: running.id } });
      expect(updatedPending?.status).toEqual(EmailNotificationStatus.CANCELLED);
      expect(updatedRunning?.status).toEqual(EmailNotificationStatus.CANCELLED);
    });
  });

  describe("resetStaleRunningEmailJobs", () => {
    it("resets only stale RUNNING jobs to PENDING", async () => {
      const { deployment, event } = await makeDeploymentAndEvent();
      const staleUpdatedAt = new Date(Date.now() - STALE_RUNNING_EMAIL_JOB_TIMEOUT_MS - 1_000);

      const staleJob = await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-1",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.RUNNING,
          runAt: new Date(),
          updatedAt: staleUpdatedAt,
        },
      });

      const freshJob = await db.emailNotification.create({
        data: {
          deploymentId: deployment.id,
          contractEventId: event.id,
          nodeId: "node-2",
          address: "G123",
          recipient: "test@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello",
          status: EmailNotificationStatus.RUNNING,
          runAt: new Date(),
        },
      });

      const reset = await resetStaleRunningEmailJobs(db);
      expect(reset).toEqual(1);

      const updatedStale = await db.emailNotification.findUnique({ where: { id: staleJob.id } });
      const updatedFresh = await db.emailNotification.findUnique({ where: { id: freshJob.id } });
      expect(updatedStale?.status).toEqual(EmailNotificationStatus.PENDING);
      expect(updatedFresh?.status).toEqual(EmailNotificationStatus.RUNNING);
    });
  });
});
