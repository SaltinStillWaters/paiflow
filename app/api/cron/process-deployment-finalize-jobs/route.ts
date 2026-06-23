import { NextRequest, NextResponse } from "next/server";
import { DeploymentFinalizeJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  getDueDeploymentFinalizeJobs,
  rescheduleDeploymentFinalizeJob,
} from "@/lib/deployment-jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    const jobs = await getDueDeploymentFinalizeJobs(db, 50);
    const results: Array<{
      jobId: string;
      deploymentId: string;
      status: "finalized" | "skipped" | "cancelled" | "failed";
      error?: string;
    }> = [];

    for (const job of jobs) {
      const deployment = await db.deployment.findUnique({
        where: { id: job.deploymentId },
        select: { status: true },
      });

      if (!deployment || deployment.status !== "SUBMITTED") {
        await rescheduleDeploymentFinalizeJob(db, job.id, {
          status:
            deployment?.status === "CONFIRMED"
              ? DeploymentFinalizeJobStatus.SKIPPED
              : DeploymentFinalizeJobStatus.CANCELLED,
        });
        results.push({
          jobId: job.id,
          deploymentId: job.deploymentId,
          status: deployment?.status === "CONFIRMED" ? "skipped" : "cancelled",
        });
        continue;
      }

      await rescheduleDeploymentFinalizeJob(db, job.id, {
        status: DeploymentFinalizeJobStatus.RUNNING,
      });

      try {
        await db.deployment.update({
          where: { id: job.deploymentId },
          data: {
            status: "FAILED",
            errorMessage: "Timed out waiting for finality",
          },
        });

        await rescheduleDeploymentFinalizeJob(db, job.id, {
          status: DeploymentFinalizeJobStatus.FINALIZED,
        });

        log.info(
          { jobId: job.id, deploymentId: job.deploymentId },
          "Deployment finalized after timeout",
        );

        results.push({
          jobId: job.id,
          deploymentId: job.deploymentId,
          status: "finalized",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { jobId: job.id, deploymentId: job.deploymentId, error: message },
          "Deployment finalization failed",
        );
        await rescheduleDeploymentFinalizeJob(db, job.id, {
          status: DeploymentFinalizeJobStatus.FAILED,
          lastError: message,
        });
        results.push({
          jobId: job.id,
          deploymentId: job.deploymentId,
          status: "failed",
          error: message,
        });
      }
    }

    const finalized = results.filter((r) => r.status === "finalized").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const cancelled = results.filter((r) => r.status === "cancelled").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      data: {
        finalized,
        skipped,
        cancelled,
        failed,
        processed: jobs.length,
      },
    });
  });
}

export const GET = POST;
