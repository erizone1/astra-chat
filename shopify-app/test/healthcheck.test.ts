import { describe, it, expect } from "vitest";
import { healthcheck } from "../src/lib/healthcheck";

describe("healthcheck", () => {
  it("returns ok", () => {
    expect(healthcheck()).toEqual({ status: "ok" });
  });
});
