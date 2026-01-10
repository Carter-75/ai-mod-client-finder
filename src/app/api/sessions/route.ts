import { NextResponse } from "next/server";
import { z } from "zod";

import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  jarNames: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const session = await scanManager.createSession({ jarNames: parsed.data.jarNames });
  return NextResponse.json({ session: session.getSummary() }, { status: 201 });
}
