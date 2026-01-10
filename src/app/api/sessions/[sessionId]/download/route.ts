import { NextResponse } from "next/server";
import { promises as fs } from "fs";

import JSZip from "jszip";

import { resolveSessionFile } from "@/server/config";
import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

interface RouteParams {
  params: { sessionId: string };
}

const FILE_BY_TYPE = {
  client: "client_only.txt",
  unknown: "unknown.txt",
} as const;

export async function GET(request: Request, { params }: RouteParams) {
  const session = await scanManager.loadSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as keyof typeof FILE_BY_TYPE | null;
  const format = searchParams.get("format") ?? "txt";
  if (!type || !(type in FILE_BY_TYPE)) {
    return NextResponse.json({ error: "Unknown download type" }, { status: 400 });
  }

  const path = resolveSessionFile(params.sessionId, FILE_BY_TYPE[type]);
  try {
    const file = await fs.readFile(path, "utf8");
    if (format === "zip") {
      const zip = new JSZip();
      const normalized = file.trim();
      const contents = normalized.length > 0 ? normalized : "No entries classified yet.";
      zip.file(`${type}-mods.txt`, contents);
      zip.file(
        `${type}-mods.json`,
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          category: type,
          entries: normalized.length > 0 ? normalized.split(/\r?\n/) : [],
        }, null, 2)
      );
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      return new Response(buffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${type}-mods.zip"`,
        },
      });
    }

    return new Response(file, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}-mods.txt"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "No data available yet" }, { status: 404 });
  }
}
