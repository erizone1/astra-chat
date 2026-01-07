import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { withEventLogging, logger } from "../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";
import { normalizeShopDomain } from "../utils/shop-param.server";

function looksLikeOAuthCallback(url: URL): boolean {
  // Detect callback without logging sensitive values
  const hasOAuthParams =
    url.searchParams.has("code") ||
    url.searchParams.has("hmac") ||
    url.searchParams.has("state");

  const pathLooksLikeCallback = url.pathname.toLowerCase().includes("callback");

  return hasOAuthParams || pathLooksLikeCallback;
}

const MYSHOPIFY_DOMAIN_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function isValidShopDomain(shop: string): boolean {
  const customDomain = process.env.SHOP_CUSTOM_DOMAIN;
  if (customDomain && shop.toLowerCase() === customDomain.toLowerCase()) {
    return true;
  }

  return MYSHOPIFY_DOMAIN_PATTERN.test(shop);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const url = new URL(request.url);

    // Normalize shop (fixes pasted full URL like https://.../admin)
    const shopDomain = normalizeShopDomain(url.searchParams.get("shop"));

    const isCallback = looksLikeOAuthCallback(url);
    const eventType = isCallback ? "oauth_callback" : "oauth_start";
    const message = isCallback ? "OAuth callback received" : "OAuth started";

    // Keep your existing validation behavior exactly for non-callback traffic
    if (!isCallback) {
      if (!shopDomain) {
        return withRequestIdHeader(
          new Response(
            "Missing shop parameter. Please provide ?shop=your-store.myshopify.com",
            {
              status: 400,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          ),
          requestId
        );
      }

      if (!isValidShopDomain(shopDomain)) {
        return withRequestIdHeader(
          new Response(
            "Invalid shop parameter. Please provide ?shop=your-store.myshopify.com",
            {
              status: 400,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          ),
          requestId
        );
      }
    }

    // Non-event diagnostic log (safe): confirms route + classification.
    logger.info("auth.route.hit", {
      path: url.pathname,
      method: request.method,
      isCallback,
      queryKeys: Array.from(url.searchParams.keys()), // keys only, no values
      shopDomain,
    });

    try {
      await withEventLogging({
        eventType,
        message,
        shopDomain,
        run: async () => {
          await authenticate.admin(request);
        },
      });

      // If authenticate.admin() doesn't redirect (rare), respond cleanly.
      return withRequestIdHeader(new Response(null, { status: 204 }), requestId);
    } catch (err: unknown) {
      // OAuth flow often throws redirect Response; preserve request id header for correlation.
      if (err instanceof Response) throw withRequestIdHeader(err, requestId);
      throw err;
    }
  });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
