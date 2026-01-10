import { NextResponse } from "next/server";
import { z } from "zod";

import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

const startSchema = z.object({
  apiKey: z.string().min(1, "OPENAI API key is required"),
});

interface RouteParams {
  params: { sessionId: string };
}

export async function POST(request: Request, { params }: RouteParams) {
  const session = await scanManager.loadSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await session.start(parsed.data.apiKey);
  return NextResponse.json({ status: session.getSummary().status, result });
}
