import { promises as fs } from "fs";
import path from "path";

import type { LogEntry, LogCategory, LogLevel } from "@/types/scanning";

import { LOG_ROOT, resolveSessionFile } from "./config";

const encoder = new TextEncoder();

async function ensureLogDir(sessionId: string) {
  const dir = path.dirname(resolveSessionFile(sessionId, "logs.jsonl"));
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(LOG_ROOT, { recursive: true });
  return dir;
}

export async function writeSessionLog(sessionId: string, entry: LogEntry) {
  await ensureLogDir(sessionId);
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(resolveSessionFile(sessionId, "logs.jsonl"), encoder.encode(line));
}

export function createLogEntry(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: Record<string, unknown>
): LogEntry {
  return {
    level,
    category,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

export type { LogEntry, LogCategory, LogLevel } from "@/types/scanning";
