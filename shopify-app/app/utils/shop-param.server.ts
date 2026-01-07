// shopify-app/app/utils/shop-param.server.ts

// Exported so routes can reuse it and avoid drifting regex variants.
export const MYSHOPIFY_DOMAIN_PATTERN =
  /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/**
 * Normalizes a shop query param into a hostname-like string:
 * - trims
 * - lowercases
 * - strips protocol
 * - strips path/query/hash
 * - strips port
 */
export function normalizeShopDomain(
  raw: string | null | undefined
): string | undefined {
  if (!raw) return undefined;

  let s = raw.trim();
  if (!s) return undefined;

  // Strip protocol if pasted as a full URL
  s = s.replace(/^https?:\/\//i, "");

  // Strip anything after slash, query, hash
  s = s.split("/")[0] ?? s;
  s = s.split("?")[0] ?? s;
  s = s.split("#")[0] ?? s;

  // Strip port if present (e.g. foo.myshopify.com:443)
  // Safe for this domain-shaped input.
  s = s.split(":")[0] ?? s;

  s = s.toLowerCase();
  return s || undefined;
}

function getCustomDomainNormalized(): string | undefined {
  const customDomain = process.env.SHOP_CUSTOM_DOMAIN;
  if (!customDomain) return undefined;
  const s = customDomain.trim().toLowerCase();
  return s || undefined;
}

export function isValidShopDomain(shop: string): boolean {
  const custom = getCustomDomainNormalized();
  if (custom && shop.toLowerCase() === custom) {
    return true;
  }
  return MYSHOPIFY_DOMAIN_PATTERN.test(shop);
}

export function validateShopQueryParam(
  raw: string | null | undefined
):
  | { ok: true; shop: string }
  | { ok: false; status: 400; message: string } {
  const shop = normalizeShopDomain(raw);

  if (!shop) {
    return {
      ok: false,
      status: 400,
      message:
        "Missing shop parameter. Please provide ?shop=your-store.myshopify.com",
    };
  }

  if (!isValidShopDomain(shop)) {
    return {
      ok: false,
      status: 400,
      message:
        "Invalid shop parameter. Please provide ?shop=your-store.myshopify.com",
    };
  }

  return { ok: true, shop };
}
