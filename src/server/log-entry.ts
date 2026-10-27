import type { LogCategory, LogEntry, LogLevel } from "@/types/scanning";

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
