export type Verdict = "CLIENT" | "SERVER" | "BOTH" | "UNKNOWN";

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

export interface ClassifyResponse {
  jar: string;
  verdict: Verdict;
  logs: LogEntry[];
  keyRejected: boolean;
  aiAvailable: boolean;
}
