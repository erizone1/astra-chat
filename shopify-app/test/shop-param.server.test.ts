import { describe, it, expect } from "vitest";
import { normalizeShopDomain, validateShopQueryParam } from "~/utils/shop-param.server";

describe("shop param helpers", () => {
  it("normalizeShopDomain returns undefined for missing/blank", () => {
    expect(normalizeShopDomain(null)).toBeUndefined();
    expect(normalizeShopDomain(undefined)).toBeUndefined();
    expect(normalizeShopDomain("   ")).toBeUndefined();
  });

  it("normalizeShopDomain lowercases + trims", () => {
    expect(normalizeShopDomain("  My-Store.MyShopify.com  ")).toBe("my-store.myshopify.com");
  });

  it("normalizeShopDomain strips protocol", () => {
    expect(normalizeShopDomain("https://my-store.myshopify.com")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("http://my-store.myshopify.com")).toBe("my-store.myshopify.com");
  });

  it("normalizeShopDomain strips path/query/hash/port", () => {
    expect(normalizeShopDomain("my-store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("my-store.myshopify.com:443")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("my-store.myshopify.com#x")).toBe("my-store.myshopify.com");
  });

  it("validateShopQueryParam returns missing error", () => {
    const r = validateShopQueryParam("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/Missing shop parameter/i);
    }
  });

  it("validateShopQueryParam returns invalid error", () => {
    const r = validateShopQueryParam("not-a-shop");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/Invalid shop parameter/i);
    }
  });

  it("validateShopQueryParam returns ok for valid myshopify domain", () => {
    const r = validateShopQueryParam("https://my-store.myshopify.com/admin");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shop).toBe("my-store.myshopify.com");
    }
  });
});
