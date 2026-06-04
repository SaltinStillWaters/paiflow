"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import DeploymentCanvas from "./deployment-canvas";
import { LiveEvents, type Evt } from "./live-events";
import type { FlowGraph } from "@/lib/flows/schema";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";

export default function DeploymentView({
  deploymentId,
  contractAddress,
  network,
  status,
  qrUrl,
  initialEvents,
  graph,
}: {
  deploymentId: string;
  contractAddress: string | null;
  network: StellarNetwork | null;
  status: string;
  qrUrl: string | null;
  initialEvents: Evt[];
  graph: FlowGraph | null;
}) {
  const explorerUrl =
    contractAddress && network ? stellarExpertContractUrl(contractAddress, network) : null;
  const [pulse, setPulse] = useState(0);
  const [events, setEvents] = useState<Evt[]>(initialEvents);
  const esRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const mergeEvents = (prev: Evt[], incoming: Evt[]) => {
    const merged = [...prev];
    let addedPulses = 0;
    for (const data of incoming) {
      const isDuplicate = merged.some((p) => p.txHash === data.txHash && p.kind === data.kind);
      if (!isDuplicate) {
        merged.unshift({ ...data, _isNew: true });
        if (data.kind === "RECEIVE" || data.kind === "PAYOUT") {
          addedPulses += 1;
        }
      }
    }
    if (addedPulses > 0) setPulse((p) => p + addedPulses);
    return merged.slice(0, 100);
  };

  const clearIsNew = (txHash: string, kind: string) => {
    setEvents((curr) =>
      curr.map((e) => (e.txHash === txHash && e.kind === kind ? { ...e, _isNew: false } : e)),
    );
  };

  const scheduleClearIsNew = (txHash: string, kind: string) => {
    setTimeout(() => clearIsNew(txHash, kind), 250);
  };

  useEffect(() => {
    if (status !== "CONFIRMED") {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const es = new EventSource(`/api/deployments/${deploymentId}/events`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setIsConnected(true);
    });

    es.addEventListener("message", (e) => {
      try {
        const event = JSON.parse(e.data) as Evt;
        setEvents((prev) => mergeEvents(prev, [event]));
        scheduleClearIsNew(event.txHash, event.kind);
      } catch {
        /* ignore */
      }
    });

    const RECONNECT_DELAY_MS = 5000;
    es.onerror = () => {
      setIsConnected(false);
      es.close();
      esRef.current = null;
      const fallbackUrl = `/api/deployments/${deploymentId}/poll-events`;
      fetch(fallbackUrl)
        .then((r) => r.json())
        .then(({ events: polledEvents }) => {
          setEvents((prev) => mergeEvents(prev, polledEvents));
          polledEvents.forEach((ev: Evt) => scheduleClearIsNew(ev.txHash, ev.kind));
        })
        .catch(() => null);
      setTimeout(() => {
        if (status === "CONFIRMED") {
          const newEs = new EventSource(`/api/deployments/${deploymentId}/events`);
          esRef.current = newEs;
        }
      }, RECONNECT_DELAY_MS);
    };

    return () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [deploymentId, status]);

  useEffect(() => {
    if (status === "CONFIRMED") return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/deployments/${deploymentId}/status`);
        if (!r.ok) return;
        const { status: newStatus } = (await r.json()) as { status: string };
        if (newStatus === "CONFIRMED") {
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [deploymentId, status]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success("Copied to clipboard.");
  }

  return (
    <div className="mt-md space-y-md">
      {graph && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface">Live flow</h2>
            <span className="text-label-sm text-on-surface-variant font-mono">
              EDGES PULSE ON-CHAIN EVENTS
            </span>
          </div>
          <DeploymentCanvas graph={graph} pulseTick={pulse} />
        </section>
      )}
      <div className="gap-md grid grid-cols-1 lg:grid-cols-2">
        <section className="glass-panel p-md rounded-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-sm text-on-surface">Trigger</h2>
            <span className="border-secondary/30 bg-secondary/10 text-label-sm text-secondary inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono">
              <span className="material-symbols-outlined text-[12px]">qr_code_2</span>
              FREIGHTER
            </span>
          </div>
          {contractAddress ? (
            <>
              <p className="text-label-sm text-on-surface-variant mt-1 font-mono">
                SCAN WITH FREIGHTER WALLET · SET AMOUNT IN TRIGGER PAGE.
              </p>
              <div className="mt-md gap-md grid grid-cols-[160px_1fr]">
                <div className="flex min-h-[160px] items-center justify-center rounded-lg bg-white p-3">
                  {qrUrl ? (
                    <img src={qrUrl} width={140} height={140} alt="QR code" />
                  ) : (
                    <span className="font-mono text-xs text-zinc-400">NO QR YET</span>
                  )}
                </div>
                <div className="text-body-md space-y-3">
                  <div>
                    <div className="text-label-sm text-on-surface-variant font-mono uppercase">
                      Contract address
                    </div>
                    <div className="mt-1 flex items-start gap-2">
                      {explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-on-surface hover:text-primary inline-flex items-center gap-1 text-left font-mono text-[12px] break-all transition-colors"
                        >
                          <span className="break-all">{contractAddress}</span>
                          <span className="material-symbols-outlined shrink-0 text-[12px]">
                            open_in_new
                          </span>
                        </a>
                      ) : (
                        <span className="text-on-surface font-mono text-[12px] break-all">
                          {contractAddress}
                        </span>
                      )}
                      <button
                        onClick={() => copy(contractAddress)}
                        aria-label="Copy contract address"
                        title="Copy contract address"
                        className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                      </button>
                    </div>
                  </div>
                  <a
                    href={`/trigger/${deploymentId}`}
                    className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 inline-block rounded border px-3 py-1.5 font-mono text-xs transition-colors"
                  >
                    OPEN TRIGGER PAGE
                  </a>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
              <span className="status-dot-deploy h-1.5 w-1.5" />
              WAITING FOR CONFIRMATION…
            </div>
          )}
        </section>

        <LiveEvents events={events} network={network} />
      </div>
    </div>
  );
}
