import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { withEventLogging, logger } from "../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

function looksLikeOAuthCallback(url: URL): boolean {
  // Detect callback without logging sensitive values
  const hasOAuthParams =
    url.searchParams.has("code") ||
    url.searchParams.has("hmac") ||
    url.searchParams.has("state");

  const pathLooksLikeCallback = url.pathname.toLowerCase().includes("callback");

  return hasOAuthParams || pathLooksLikeCallback;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") ?? undefined;

    const isCallback = looksLikeOAuthCallback(url);
    const eventType = isCallback ? "oauth_callback" : "oauth_start";
    const message = isCallback ? "OAuth callback received" : "OAuth started";

    // Non-event diagnostic log (safe): confirms route + classification.
    // Keep it if useful; remove later if too noisy.
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
