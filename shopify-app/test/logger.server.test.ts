// test/logger.server.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "../app/utils/logger.server";

describe("logger redaction", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
    errSpy.mockClear();
  });

  it("does not leak sensitive values for known sensitive keys", () => {
    logger.info("test", {
      accessToken: "shpat_1234567890",
      authorization: "Bearer abc.def.ghi",
      email: "test@example.com",
      phone: "+1-555-123-4567",
      nested: { hmac: "deadbeef", code: "abc" },
      payload: { email: "should-not-appear@example.com" }, // should be omitted/redacted
    });

    const out = logSpy.mock.calls[0][0] as string;

    expect(out).not.toContain("shpat_1234567890");
    expect(out).not.toContain("Bearer abc.def.ghi");
    expect(out).not.toContain("test@example.com");
    expect(out).not.toContain("+1-555-123-4567");
    expect(out).not.toContain("deadbeef");
    expect(out).not.toContain('"code":"abc"');
    expect(out).not.toContain("should-not-appear@example.com");

    JSON.parse(out);
  });

  it("does not leak token-like strings even under non-sensitive keys", () => {
    logger.info("test", {
      note: "Bearer supersecrettoken",
      jwt: "aaa.bbb.ccc",
      maybeToken: "shpat_abcdef",
      opaque: "a".repeat(40),
    });

    const out = logSpy.mock.calls[0][0] as string;

    expect(out).not.toContain("Bearer supersecrettoken");
    expect(out).not.toContain("aaa.bbb.ccc");
    expect(out).not.toContain("shpat_abcdef");
    expect(out).not.toContain("a".repeat(40));

    JSON.parse(out);
  });

  it("sanitizes errorMessage (no oauth params/tokens leak)", () => {
    logger.error("oops", {
      errorMessage: "failed with code=abcd1234&hmac=ffff&state=zzzz token=shpat_123",
    });

    const out = errSpy.mock.calls[0][0] as string;

    expect(out).not.toContain("abcd1234");
    expect(out).not.toContain("ffff");
    expect(out).not.toContain("zzzz");
    expect(out).not.toContain("shpat_123");

    JSON.parse(out);
  });

it("does not redact UUIDs like webhookId", () => {
  const id = "2feb21ca-d583-4d96-888c-e0af91f64305";

  logger.info("test", { webhookId: id });

  const out = logSpy.mock.calls[0][0] as string;

  expect(out).toContain(id);
});


});
