import { NextResponse } from "next/server";

import { scanManager } from "@/server/scanner/manager";
import type { ScanEvent } from "@/types/scanning";

export const runtime = "nodejs";

interface RouteParams {
  params: { sessionId: string };
}

const encoder = new TextEncoder();

function serializeEvent(event: ScanEvent) {
  const payload = JSON.stringify(event);
  return encoder.encode(`data: ${payload}\n\n`);
}

export async function GET(_request: Request, { params }: RouteParams) {
  const session = await scanManager.loadSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
          cleanup?.();
        }
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
      }, 15000);

      const listener = (event: ScanEvent) => safeEnqueue(serializeEvent(event));
      session.on("event", listener);

      safeEnqueue(serializeEvent({ type: "snapshot", payload: session.getSummary() }));
      safeEnqueue(encoder.encode("retry: 2000\n\n"));
      safeEnqueue(
        encoder.encode(
          `event: ready\ndata: ${JSON.stringify({ status: session.getSummary().status })}\n\n`
        )
      );

      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        session.off("event", listener);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
