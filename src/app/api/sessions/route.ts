import { NextResponse } from "next/server";
import { z } from "zod";

import { scanManager } from "@/server/scanner/manager";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  jarNames: z.array(z.string().min(1).max(300)).min(1).max(500),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const session = await scanManager.createSession({ jarNames: parsed.data.jarNames });
    if (session.jarNames.length === 0) {
      return NextResponse.json({ error: "No .jar files were provided" }, { status: 400 });
    }
    return NextResponse.json({ session: session.getSummary() }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
