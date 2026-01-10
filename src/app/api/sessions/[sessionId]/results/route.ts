import { NextResponse } from "next/server";

import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

interface RouteParams {
  params: { sessionId: string };
}

export async function GET(_request: Request, { params }: RouteParams) {
  const session = await scanManager.loadSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const results = await session.getResults();
  return NextResponse.json(results);
}
