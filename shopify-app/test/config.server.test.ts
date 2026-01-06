import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger BEFORE importing config
vi.mock("../app/utils/logger.server", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../app/utils/logger.server";
import { validateRequiredConfig, REQUIRED_ENV_VARS } from "../app/utils/config.server";

type RequiredKey = (typeof REQUIRED_ENV_VARS)[number];

function getLoggerErrorCalls(): unknown[][] {
  const errFn = logger.error as unknown as { mock: { calls: unknown[][] } };
  return errFn.mock.calls;
}

function extractMissingKeysFromFirstErrorCall(): string[] {
  const calls = getLoggerErrorCalls();
  expect(calls.length).toBeGreaterThan(0);

  const args = calls[0] ?? [];

  for (const a of args) {
    if (typeof a === "object" && a !== null) {
      const mk = (a as Record<string, unknown>)["missingKeys"];
      if (Array.isArray(mk) && mk.every((x) => typeof x === "string")) {
        return mk;
      }
    }
  }

  throw new Error("missingKeys not found in logger.error call args");
}

function stringifyFirstErrorCallArgs(): string {
  const calls = getLoggerErrorCalls();
  if (!calls.length) return "";
  const args = calls[0] ?? [];
  return args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" | ");
}

function makeEnv(
  overrides: Partial<Record<RequiredKey, string | undefined>> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of REQUIRED_ENV_VARS) env[k] = "ok";
  for (const [k, v] of Object.entries(overrides)) env[k] = v;
  return env;
}

describe("validateRequiredConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when all required env vars exist", () => {
    const env = makeEnv();
    expect(() => validateRequiredConfig(env)).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws and logs missing keys when blank/whitespace", () => {
    const keyA = REQUIRED_ENV_VARS[0];
    const keyB = REQUIRED_ENV_VARS[1];

    const env = makeEnv({
      [keyA]: "",
      [keyB]: "   ",
    });

    expect(() => validateRequiredConfig(env)).toThrow(/Missing required configuration keys/i);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const missingKeys = extractMissingKeysFromFirstErrorCall();
    expect(missingKeys).toEqual([keyA, keyB]);
  });

  it("does not leak existing env VALUES into logs (keys-only)", () => {
    const missingKey = REQUIRED_ENV_VARS[0];
    const secretValue = "SUPER_SECRET_SHOULD_NOT_APPEAR";

    const env = makeEnv({
      [missingKey]: "",
      [REQUIRED_ENV_VARS[2]]: secretValue,
    });

    expect(() => validateRequiredConfig(env)).toThrow();

    const joined = stringifyFirstErrorCallArgs();
    expect(joined).not.toContain(secretValue);
  });

  it("uses process.env when called with no argument", () => {
    const keyMissing = REQUIRED_ENV_VARS[0];

    const prev = process.env[keyMissing];
    process.env[keyMissing] = "";

    try {
      expect(() => validateRequiredConfig()).toThrow();
      const missingKeys = extractMissingKeysFromFirstErrorCall();
      expect(missingKeys).toEqual([keyMissing]);
    } finally {
      if (prev === undefined) delete process.env[keyMissing];
      else process.env[keyMissing] = prev;
    }
  });

  // Keep ONLY if your production code treats CHANGEME/replace_me/todo as missing
  it("treats obvious placeholders as missing", () => {
    const key = REQUIRED_ENV_VARS[0];
    const env = makeEnv({ [key]: "CHANGEME" });

    expect(() => validateRequiredConfig(env)).toThrow();
  });
});
