import { NextResponse } from "next/server";
import { z } from "zod";

import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

// The API key is optional. A visitor-supplied key wins; otherwise the
// server-configured OPENAI_API_KEY is used; with neither, the scan runs on
// Modrinth data alone and unsettled mods are reported as UNKNOWN.
const startSchema = z.object({
  apiKey: z.string().trim().max(300).optional().default(""),
});

interface RouteParams {
  params: { sessionId: string };
}

export async function POST(request: Request, { params }: RouteParams) {
  const session = await scanManager.loadSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = startSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await session.start(parsed.data.apiKey);
    return NextResponse.json({ status: session.getSummary().status, result });
  } catch (error) {
    console.error("Failed to start session", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start scanning session" },
      { status: 400 }
    );
  }
}
