// shopify-app/app/utils/config.server.ts
import { logger } from "./logger.server";

export const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
] as const;

type RequiredKey = (typeof REQUIRED_ENV_VARS)[number];

function isMissing(v: string | undefined): boolean {
  if (!v) return true;
  const t = v.trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  return lower === "changeme" || lower === "replace_me" || lower === "todo";
}

/**
 * Throws on missing config (safe: logs only missing key names).
 * Call this during startup (before the server listens).
 */
export function validateRequiredConfig(env: NodeJS.ProcessEnv = process.env): void {
  const missingKeys: RequiredKey[] = REQUIRED_ENV_VARS.filter((k) => isMissing(env[k]));

  if (missingKeys.length > 0) {

logger.error("Missing required configuration keys", {
  missingKeys,
  eventType: "startup_config",
  requestId: "startup",
  merchantId: null,
  errorCode: "MISSING_CONFIG",
  errorMessage: "Missing required server configuration",
});

      }
}
