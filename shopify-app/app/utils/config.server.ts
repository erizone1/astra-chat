// shopify-app/app/utils/config.server.ts
import { logger } from "./logger.server";

export const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
] as const;

type RequiredKey = (typeof REQUIRED_ENV_VARS)[number];

// Expand placeholders slightly: tests explicitly mention "CHANGEME" and "obvious placeholders"
const PLACEHOLDER_VALUES = new Set(["changeme", "replace_me", "todo", "tbd"]);

function isMissing(v: string | undefined): boolean {
  if (v === undefined) return true;

  const t = v.trim();
  if (!t) return true;

  const lower = t.toLowerCase();

  // treat obvious placeholders as missing
  if (PLACEHOLDER_VALUES.has(lower)) return true;

  return false;
}

/**
 * Throws on missing config (safe: logs only missing key names).
 * Call this during startup (before the server listens).
 */
export function validateRequiredConfig(env: NodeJS.ProcessEnv = process.env): void {
  const missingKeys: RequiredKey[] = REQUIRED_ENV_VARS.filter((k) => isMissing(env[k]));

  if (missingKeys.length > 0) {
    // IMPORTANT: keys-only (do not log env values)
    logger.error("Missing required configuration keys", {
      missingKeys,
      eventType: "startup_config",
      requestId: "startup",
      merchantId: null,
      errorCode: "MISSING_CONFIG",
      errorMessage: "Missing required server configuration",
    });

    // ✅ This is what your tests are expecting
    throw new Error(`Missing required configuration keys: ${missingKeys.join(", ")}`);
  }
}

