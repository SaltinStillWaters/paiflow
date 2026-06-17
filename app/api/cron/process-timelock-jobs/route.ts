import { NextRequest, NextResponse } from "next/server";
import { TimelockReleaseJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareReleaseByRelayerTx, submitReleaseByRelayerTx } from "@/lib/stellar/relayer";
import { withRelayerLock } from "@/lib/stellar/client";
import {
  cancelPendingTimelockJobs,
  getDueTimelockJobs,
  rescheduleTimelockJob,
  resetStaleRunningTimelockJobs,
} from "@/lib/timelock-jobs";

export const dynamic = "force-dynamic";

const MAX_RETRY_ATTEMPTS = 3;

function isRetryableError(message: string): boolean {
  return (
    message.includes("txBadSeq") ||
    message.includes("BadSequence") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("RateLimit")
  );
}

function isKnownSkipError(message: string): boolean {
  return (
    message.includes("NothingToRelease") ||
    message.includes("ConditionNotMet") ||
    message.includes("non-existent contract function") ||
    message.includes("MissingValue") ||
    message.includes("Unauthorized")
  );
}

async function scheduleRetry(jobId: string, attemptCount: number, errorMessage: string) {
  const retryAt = new Date(Date.now() + 60_000 * (attemptCount + 1));
  await db.timelockReleaseJob.update({
    where: { id: jobId },
    data: {
      status: TimelockReleaseJobStatus.PENDING,
      runAt: retryAt,
      lastError: errorMessage,
      attemptCount: { increment: 1 },
    },
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    // Recover from any previous cron invocation that crashed or timed out while
    // a job was in RUNNING. A 10-minute timeout is generous for a Stellar TX.
    await resetStaleRunningTimelockJobs(db);

    const jobs = await getDueTimelockJobs(db, 50);
    const results: Array<{
      jobId: string;
      contractAddress: string;
      status: "released" | "skipped" | "failed" | "cancelled";
      error?: string;
    }> = [];

    for (const job of jobs) {
      const deployment = await db.deployment.findUnique({
        where: { id: job.deploymentId },
        select: { status: true },
      });

      if (!deployment || deployment.status !== "CONFIRMED") {
        await cancelPendingTimelockJobs(db, job.deploymentId);
        results.push({
          jobId: job.id,
          contractAddress: job.contractAddress,
          status: "cancelled",
          error: "Deployment no longer CONFIRMED",
        });
        continue;
      }

      await rescheduleTimelockJob(db, job.id, {
        status: TimelockReleaseJobStatus.RUNNING,
      });

      try {
        const submit = await withRelayerLock(async () => {
          const { xdr } = await prepareReleaseByRelayerTx(job.contractAddress);
          return submitReleaseByRelayerTx(xdr);
        });

        if (submit.status === "SUCCESS") {
          log.info(
            {
              jobId: job.id,
              deploymentId: job.deploymentId,
              contractAddress: job.contractAddress,
              txHash: submit.txHash,
            },
            "Timelock release succeeded",
          );
          await rescheduleTimelockJob(db, job.id, {
            status: TimelockReleaseJobStatus.RELEASED,
            releasedAt: new Date(),
          });
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "released",
          });
        } else {
          const errorMessage = submit.errorMessage ?? "Submission failed";
          if (isRetryableError(errorMessage) && job.attemptCount < MAX_RETRY_ATTEMPTS) {
            await scheduleRetry(job.id, job.attemptCount, errorMessage);
          } else {
            await rescheduleTimelockJob(db, job.id, {
              status: TimelockReleaseJobStatus.FAILED,
              lastError: errorMessage,
            });
          }
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "failed",
            error: errorMessage,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (isKnownSkipError(message)) {
          await rescheduleTimelockJob(db, job.id, {
            status: TimelockReleaseJobStatus.SKIPPED,
            lastError: message,
          });
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "skipped",
          });
        } else if (isRetryableError(message) && job.attemptCount < MAX_RETRY_ATTEMPTS) {
          await scheduleRetry(job.id, job.attemptCount, message);
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "failed",
            error: message,
          });
        } else {
          log.warn(
            {
              jobId: job.id,
              deploymentId: job.deploymentId,
              contractAddress: job.contractAddress,
              error: message,
            },
            "Timelock release failed",
          );
          await rescheduleTimelockJob(db, job.id, {
            status: TimelockReleaseJobStatus.FAILED,
            lastError: message,
          });
          results.push({
            jobId: job.id,
            contractAddress: job.contractAddress,
            status: "failed",
            error: message,
          });
        }
      }
    }

    const released = results.filter((r) => r.status === "released").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const cancelled = results.filter((r) => r.status === "cancelled").length;

    return NextResponse.json({
      data: {
        released,
        skipped,
        failed,
        cancelled,
        processed: jobs.length,
        details: results,
      },
    });
  });
}

export const GET = POST;
