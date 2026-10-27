import { ensureInfrastructure, isValidSessionId } from "@/server/config";
import { ScanSession } from "@/server/scanner/session";

interface CreateSessionPayload {
  jarNames: string[];
}

class ScanManager {
  private sessions = new Map<string, ScanSession>();
  private initialized = false;

  private async init() {
    if (this.initialized) return;
    try {
      await ensureInfrastructure();
    } catch (error) {
      // Storage can be unavailable on serverless hosting. Sessions still
      // work from memory; disk persistence is best effort.
      console.warn("Unable to initialize scan storage; continuing in memory only.", error);
    }
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
    if (!isValidSessionId(sessionId)) {
      return null;
    }
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    const session = await ScanSession.load(sessionId);
    if (session) {
      this.sessions.set(session.id, session);
    }
    return session ?? null;
  }

  // Only real .jar file names are scanned. Directory paths from folder
  // pickers are reduced to base names, and anything else is dropped.
  private sanitizeJarNames(jarNames: string[]) {
    const normalized = jarNames
      .map((name) => name.trim().split(/[\\/]/).pop() ?? "")
      .filter((name) => name.toLowerCase().endsWith(".jar"));
    return Array.from(new Set(normalized));
  }
}

export const scanManager = new ScanManager();
