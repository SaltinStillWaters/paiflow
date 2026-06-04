import { log } from "@/lib/log";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { redisSub, eventChannel } from "@/lib/redis";
import { AppError } from "@/lib/errors";
import { pollEventsFor } from "@/lib/stellar/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const deployment = await db.deployment.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, status: true, contractAddress: true },
  });
  if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");

  const encoder = new TextEncoder();
  let subscribed = false;
  let aborted = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* already closed */
        }
      };

      const sendEvent = (event: object, eventType = "message") => {
        send(`event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const ping = () => send(": ping\n\n");

      let pingInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        aborted = true;
        if (pingInterval) clearInterval(pingInterval);
      };

      const sub = redisSub();
      if (!sub) {
        controller.close();
        return;
      }

      const channel = eventChannel(id);

      sub.subscribe(channel, (err) => {
        if (err) {
          log.warn({ err, channel }, "SSE redis subscribe failed");
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        subscribed = true;

        pingInterval = setInterval(() => {
          if (!aborted) ping();
        }, 15000);

        pollEventsFor(id).catch((err) => {
          log.warn({ err, id }, "initial pollEventsFor failed");
        });

        sendEvent({ type: "connected", deploymentId: id }, "connected");
      });

      sub.on("message", (ch, msg) => {
        if (ch !== channel || aborted) return;
        try {
          const event = JSON.parse(msg);
          sendEvent(event);
        } catch {
          /* ignore malformed */
        }
      });

      req.signal.addEventListener("abort", () => {
        cleanup();
        if (subscribed) {
          sub.unsubscribe(channel).catch(() => null);
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
