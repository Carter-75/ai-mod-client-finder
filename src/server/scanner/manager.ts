import { promises as fs } from "fs";
import { ensureInfrastructure, SESSION_STORAGE_ROOT } from "@/server/config";
import { ScanSession } from "@/server/scanner/session";

interface CreateSessionPayload {
  jarNames: string[];
}

class ScanManager {
  private sessions = new Map<string, ScanSession>();
  private initialized = false;

  private async init() {
    if (this.initialized) return;
    await ensureInfrastructure();
    this.initialized = true;
  }

  async createSession(payload: CreateSessionPayload) {
    await this.init();
    const sanitized = this.sanitizeJarNames(payload.jarNames);
    const session = await ScanSession.initialize(sanitized);
    this.sessions.set(session.id, session);
    return session;
  }

  async loadSession(sessionId: string) {
    await this.init();
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    const session = await ScanSession.load(sessionId);
    if (session) {
      this.sessions.set(session.id, session);
    }
    return session ?? null;
  }

  async listSessionIds() {
    await this.init();
    const entries = await fs.readdir(SESSION_STORAGE_ROOT).catch(() => [] as string[]);
    return entries.filter((folder) => folder.length > 0);
  }

  async ensureSession(sessionId: string, jarNames?: string[]) {
    const existing = await this.loadSession(sessionId);
    if (existing) {
      return existing;
    }
    if (!jarNames?.length) {
      return null;
    }
    const session = await ScanSession.initialize(jarNames);
    this.sessions.set(session.id, session);
    return session;
  }

  private sanitizeJarNames(jarNames: string[]) {
    const normalized = jarNames.map((name) => name.trim()).filter(Boolean);
    return Array.from(new Set(normalized));
  }
}

export const scanManager = new ScanManager();
