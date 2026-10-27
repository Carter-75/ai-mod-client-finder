import os from "os";
import path from "path";
import { promises as fs } from "fs";

const root = process.cwd();

export const PROJECT_ROOT = root;

// Session data must live somewhere writable. Locally that is the project
// directory. On Vercel the project directory is read-only, so fall back to
// the OS temp directory. Temp storage on serverless hosting is ephemeral:
// sessions survive while the deployment instance lives, not across
// redeploys. In-memory state in the scan manager is the runtime source of
// truth; disk persistence is best effort.
export const DATA_ROOT = process.env.SCAN_DATA_DIR
  ? path.resolve(process.env.SCAN_DATA_DIR)
  : process.env.VERCEL
    ? path.join(os.tmpdir(), "ai-mod-client-finder")
    : PROJECT_ROOT;

export const STORAGE_ROOT = path.join(DATA_ROOT, "storage");
export const SESSION_STORAGE_ROOT = path.join(STORAGE_ROOT, "sessions");
export const LOG_ROOT = path.join(DATA_ROOT, "logs");

const SESSION_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidSessionId(sessionId: string) {
  return SESSION_ID_PATTERN.test(sessionId);
}

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
