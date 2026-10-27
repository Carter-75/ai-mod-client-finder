import { NextResponse } from "next/server";

import JSZip from "jszip";

import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

interface RouteParams {
  params: { sessionId: string };
}

const VALID_TYPES = new Set(["client", "unknown"]);

// Downloads are generated from the session's in-memory results (which are
// also what gets persisted), never by reading result files back from disk.
// An empty category after a scan is a real result, so it downloads as an
// empty list rather than a 404.
export async function GET(request: Request, { params }: RouteParams) {
  const session = await scanManager.loadSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const format = searchParams.get("format") ?? "txt";
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json({ error: "Unknown download type" }, { status: 400 });
  }

  const results = await session.getResults();
  const entries = (type === "client" ? results.clientOnly : results.unknown).slice().sort();
  const body = entries.length > 0 ? entries.join("\n") + "\n" : "No entries classified yet.\n";

  if (format === "zip") {
    const zip = new JSZip();
    zip.file(`${type}-mods.txt`, body);
    zip.file(
      `${type}-mods.json`,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          category: type,
          entries,
        },
        null,
        2
      )
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${type}-mods.zip"`,
      },
    });
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-mods.txt"`,
    },
  });
}
