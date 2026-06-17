#!/usr/bin/env tsx
import "dotenv/config";
import { startWorkers, stopWorkers } from "@/lib/workers";
import { log } from "@/lib/log";

async function main() {
  log.info("Starting Pink Raft event polling worker");

  const started = await startWorkers();
  if (!started) {
    log.info("Exiting: event queue is not enabled or Redis is unavailable");
    process.exit(0);
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Worker received shutdown signal");
    await stopWorkers();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Keep the process alive. BullMQ workers run background blocking connections;
  // this prevents the script from exiting immediately.
  setInterval(() => {
    /* no-op heartbeat */
  }, 60_000);
}

main().catch((err) => {
  log.error({ err }, "Worker failed to start");
  process.exit(1);
});
