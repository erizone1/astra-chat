import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

// IMPORTANT: mock logger BEFORE importing config.server.ts
vi.mock("../app/utils/logger.server", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../app/utils/logger.server";

// We'll import config dynamically after mocks are in place.
let validateRequiredConfig: (env?: NodeJS.ProcessEnv) => void;
let REQUIRED_ENV_VARS: readonly string[];

function extractMissingKeysFromLoggerCall(): string[] {
  const calls = (logger.error as unknown as { mock: { calls: any[][] } }).mock.calls;
  expect(calls.length).toBeGreaterThan(0);

  const args = calls[0];

  // Support both logger signatures:
  // 1) logger.error({missingKeys}, "msg")
  // 2) logger.error("msg", {missingKeys})
  const objArg = args.find(
    (a: unknown) =>
      a &&
      typeof a === "object" &&
      Array.isArray((a as any).missingKeys)
  ) as { missingKeys: string[] } | undefined;

  expect(objArg).toBeTruthy();
  return objArg!.missingKeys;
}

function stringifyLoggerArgs(): string {
  const calls = (logger.error as unknown as { mock: { calls: any[][] } }).mock.calls;
  if (!calls.length) return "";
  // JSON stringify the args in a stable way for “no secret leakage” checks
  return calls[0].map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" | ");
}

function makeEnv(overrides: Partial<Record<string, string | undefined>> = {}): NodeJS.ProcessEnv {
  const base: Record<string, string> = {};
  for (const k of REQUIRED_ENV_VARS) base[k] = "ok";
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe("validateRequiredConfig", () => {
  beforeAll(async () => {
    const mod = await import("../app/utils/config.server");
    // If you did NOT export REQUIRED_ENV_VARS, either export it (recommended),
    // or replace the next line with a hard-coded list matching your config.server.ts.
    REQUIRED_ENV_VARS = mod.REQUIRED_ENV_VARS ?? mod.REQUIRED_ENV_KEYS;
    validateRequiredConfig = mod.validateRequiredConfig;

    expect(Array.isArray(REQUIRED_ENV_VARS)).toBe(true);
    expect(typeof validateRequiredConfig).toBe("function");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when all required env vars exist", () => {
    const env = makeEnv();
    expect(() => validateRequiredConfig(env)).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws and logs missing keys when values are blank/whitespace", () => {
    const keyA = REQUIRED_ENV_VARS[0];
    const keyB = REQUIRED_ENV_VARS[1];

    const env = makeEnv({
      [keyA]: "",
      [keyB]: "   ",
    });

    expect(() => validateRequiredConfig(env)).toThrow(/Missing required configuration keys/i);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const missingKeys = extractMissingKeysFromLoggerCall();
    expect(missingKeys).toEqual([keyA, keyB]); // preserves list order from REQUIRED_ENV_VARS
  });

  it("does not leak existing env VALUES into logs (keys-only)", () => {
    const missingKey = REQUIRED_ENV_VARS[0];
    const secretValue = "SUPER_SECRET_SHOULD_NOT_APPEAR";

    const env = makeEnv({
      // force one missing to trigger logging
      [missingKey]: "",
      // set another to a “secret” and ensure it doesn’t show up anywhere in log args
      [REQUIRED_ENV_VARS[2]]: secretValue,
    });

    expect(() => validateRequiredConfig(env)).toThrow();

    const joined = stringifyLoggerArgs();
    expect(joined).not.toContain(secretValue);
  });

  it("uses process.env when called with no argument", () => {
    const keyMissing = REQUIRED_ENV_VARS[0];

    const prev = process.env[keyMissing];
    process.env[keyMissing] = ""; // trigger missing

    try {
      expect(() => validateRequiredConfig()).toThrow();
      const missingKeys = extractMissingKeysFromLoggerCall();
      expect(missingKeys).toEqual([keyMissing]);
    } finally {
      // restore
      if (prev === undefined) delete process.env[keyMissing];
      else process.env[keyMissing] = prev;
    }
  });

  // OPTIONAL: only keep this test if your production code actually enforces placeholders.
  it("treats obvious placeholders as missing (ONLY if implemented)", () => {
    const key = REQUIRED_ENV_VARS[0];
    const env = makeEnv({ [key]: "CHANGEME" });

    // If you removed placeholder detection from production code, delete this test.
    expect(() => validateRequiredConfig(env)).toThrow();
  });
});
