import "server-only";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export const POLL_DEPLOYMENT_EVENTS_QUEUE = "poll-deployment-events";

let queue: Queue | null | undefined;
let connection: Redis | null | undefined;

function createBullRedisConnection(): Redis | null {
  const url = env().REDIS_URL;
  if (!url) {
    return null;
  }

  return new Redis(url, {
    lazyConnect: false,
    // BullMQ uses blocking commands; ioredis must retry indefinitely.
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
}

let queueConnection: Redis | null | undefined;

export function getBullRedisConnection(): Redis | null {
  if (queueConnection !== undefined) return queueConnection;

  const conn = createBullRedisConnection();
  if (conn) {
    conn.on("error", (err) => {
      log.warn({ err }, "BullMQ Redis connection error");
    });
  }
  queueConnection = conn ?? null;
  return queueConnection;
}

/**
 * Creates a fresh Redis connection suitable for a BullMQ Worker. Workers
 * should not share the queue's connection because they issue blocking commands.
 */
export function createWorkerRedisConnection(): Redis | null {
  const conn = createBullRedisConnection();
  if (conn) {
    conn.on("error", (err) => {
      log.warn({ err }, "BullMQ worker Redis connection error");
    });
  }
  return conn;
}

/**
 * Returns the BullMQ queue for per-deployment event polling, or null when the
 * queue is disabled or Redis is unavailable. The queue is a singleton; callers
 * should not cache it across hot reloads in dev.
 */
export function getQueue(): Queue | null {
  if (queue !== undefined) return queue;

  if (!env().EVENT_QUEUE_ENABLED) {
    queue = null;
    return queue;
  }

  const conn = getBullRedisConnection();
  if (!conn) {
    queue = null;
    return queue;
  }

  try {
    queue = new Queue(POLL_DEPLOYMENT_EVENTS_QUEUE, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 10,
      },
    });
  } catch (err) {
    log.warn({ err }, "Failed to create BullMQ queue");
    queue = null;
  }

  return queue;
}

/**
 * Closes the queue and its Redis connection. Used during worker shutdown.
 */
export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = undefined;
  }
}
