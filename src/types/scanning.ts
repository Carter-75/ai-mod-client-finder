export type Verdict = "CLIENT" | "SERVER" | "BOTH" | "UNKNOWN";

export type SessionStatus = "idle" | "running" | "completed" | "error";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory =
  | "session"
  | "scraping"
  | "ai"
  | "rate-limit"
  | "state"
  | "timeout"
  | "ads"
  | "system";

export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ProgressSnapshot {
  processed: number;
  total: number;
  status: SessionStatus;
  lastJar?: string;
}

export interface SessionSummary extends ProgressSnapshot {
  id: string;
  jarNames: string[];
  clientOnly: string[];
  unknown: string[];
  state: Record<string, Verdict>;
}

export type ScanEvent =
  | { type: "log"; payload: LogEntry }
  | { type: "progress"; payload: ProgressSnapshot }
  | { type: "status"; payload: SessionStatus }
  | { type: "result"; payload: { jar: string; verdict: Verdict } }
  | { type: "snapshot"; payload: SessionSummary };
