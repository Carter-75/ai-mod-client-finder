import { NextResponse } from "next/server";
import { z } from "zod";

import { classifyJar } from "@/server/scanner/classify";
import { createLogEntry } from "@/server/log-entry";
import type { ClassifyResponse, LogEntry } from "@/types/scanning";

export const runtime = "nodejs";
// One classification can take a while when the AI fallback runs (two
// search fetches plus two bounded OpenAI calls). Ask for the longest
// function window the platform offers; on plans with a lower cap the
// platform applies its own limit.
export const maxDuration = 300;

const classifySchema = z.object({
  jar: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((value) => value.toLowerCase().endsWith(".jar"), "Only .jar file names can be classified"),
  // Optional: a visitor-supplied key wins; otherwise the server-configured
  // OPENAI_API_KEY is used; with neither, classification is Modrinth-only.
  apiKey: z.string().trim().max(300).optional().default(""),
});

/**
 * Classify one mod jar. This endpoint is deliberately stateless: the
 * browser owns the mod list, progress, and results (persisted in
 * localStorage), because serverless instances share no memory or disk, so
 * server-side sessions cannot survive from one request to the next.
 */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = classifySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const jar = parsed.data.jar.split(/[\\/]/).pop() as string;
  const apiKey = parsed.data.apiKey || process.env.OPENAI_API_KEY?.trim() || "";

  const logs: LogEntry[] = [];
  try {
    const outcome = await classifyJar((entry) => logs.push(entry), jar, apiKey);
    const response: ClassifyResponse = {
      jar,
      verdict: outcome.verdict,
      logs,
      keyRejected: outcome.keyRejected,
      aiAvailable: outcome.aiAvailable,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Classification failed", jar, error);
    logs.push(
      createLogEntry("error", "system", "Classification failed unexpectedly; marking UNKNOWN.", {
        jar,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    const response: ClassifyResponse = {
      jar,
      verdict: "UNKNOWN",
      logs,
      keyRejected: false,
      aiAvailable: Boolean(apiKey),
    };
    return NextResponse.json(response);
  }
}
