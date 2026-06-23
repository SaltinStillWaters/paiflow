import { NextRequest, NextResponse } from "next/server";
import { EmailNotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import { sendEmail } from "@/lib/mail";
import {
  getDueEmailNotifications,
  rescheduleEmailJob,
  resetStaleRunningEmailJobs,
} from "@/lib/email-jobs";

export const dynamic = "force-dynamic";

const MAX_RETRY_ATTEMPTS = 5;

function computeRetryDelay(attemptCount: number): number {
  // 1min, 2min, 4min, 8min, 16min
  return 60_000 * Math.pow(2, attemptCount);
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    // Recover from any previous cron invocation that crashed or timed out while
    // a job was in RUNNING.
    await resetStaleRunningEmailJobs(db);

    const jobs = await getDueEmailNotifications(db, 50);
    const results: Array<{
      jobId: string;
      contractEventId: string;
      status: "sent" | "failed" | "retrying";
      error?: string;
    }> = [];

    for (const job of jobs) {
      // Defensive: skip jobs that were created without rendered content. These
      // can only come from pre-migration rows; new jobs always store content.
      if (!job.subject || !job.html || !job.text) {
        await rescheduleEmailJob(db, job.id, {
          status: EmailNotificationStatus.FAILED,
          lastError: "Missing rendered email content",
        });
        results.push({
          jobId: job.id,
          contractEventId: job.contractEventId,
          status: "failed",
          error: "Missing rendered email content",
        });
        continue;
      }

      await rescheduleEmailJob(db, job.id, {
        status: EmailNotificationStatus.RUNNING,
      });

      const result = await sendEmail({
        to: job.recipient,
        subject: job.subject,
        html: job.html,
        text: job.text,
      });

      if (result.ok) {
        await rescheduleEmailJob(db, job.id, {
          status: EmailNotificationStatus.SENT,
          sentAt: new Date(),
        });
        results.push({
          jobId: job.id,
          contractEventId: job.contractEventId,
          status: "sent",
        });
        continue;
      }

      const errorMessage = result.error.message ?? "Email send failed";

      if (job.attemptCount < MAX_RETRY_ATTEMPTS) {
        const retryAt = new Date(Date.now() + computeRetryDelay(job.attemptCount));
        await db.emailNotification.update({
          where: { id: job.id },
          data: {
            status: EmailNotificationStatus.PENDING,
            runAt: retryAt,
            lastError: errorMessage,
            attemptCount: { increment: 1 },
          },
        });
        results.push({
          jobId: job.id,
          contractEventId: job.contractEventId,
          status: "retrying",
          error: errorMessage,
        });
      } else {
        await rescheduleEmailJob(db, job.id, {
          status: EmailNotificationStatus.FAILED,
          lastError: errorMessage,
        });
        results.push({
          jobId: job.id,
          contractEventId: job.contractEventId,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const retrying = results.filter((r) => r.status === "retrying").length;
    const failed = results.filter((r) => r.status === "failed").length;

    if (failed > 0) {
      log.warn({ sent, retrying, failed }, "send-emails cron finished with failures");
    } else {
      log.info({ sent, retrying, failed, processed: jobs.length }, "send-emails cron finished");
    }

    return NextResponse.json({
      data: { sent, retrying, failed, processed: jobs.length },
    });
  });
}

export const GET = POST;
