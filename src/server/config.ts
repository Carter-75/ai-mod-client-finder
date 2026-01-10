import path from "path";
import { promises as fs } from "fs";

const root = process.cwd();

export const PROJECT_ROOT = root;
export const STORAGE_ROOT = path.join(PROJECT_ROOT, "storage");
export const SESSION_STORAGE_ROOT = path.join(STORAGE_ROOT, "sessions");
export const LOG_ROOT = path.join(PROJECT_ROOT, "logs");

async function ensureDir(target: string) {
  await fs.mkdir(target, { recursive: true });
}

export async function ensureInfrastructure() {
  await Promise.all([
    ensureDir(STORAGE_ROOT),
    ensureDir(SESSION_STORAGE_ROOT),
    ensureDir(LOG_ROOT),
  ]);
}

export function resolveSessionDir(sessionId: string) {
  return path.join(SESSION_STORAGE_ROOT, sessionId);
}

export function resolveSessionFile(sessionId: string, name: string) {
  return path.join(resolveSessionDir(sessionId), name);
}
