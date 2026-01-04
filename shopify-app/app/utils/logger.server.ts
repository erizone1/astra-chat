// app/utils/logger.server.ts
import { getRequestId } from "./request-id.server";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    requestId: getRequestId(),
    ...(meta ?? {}),
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(payload);

  // JSON-only output (friendly for log parsers)
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
