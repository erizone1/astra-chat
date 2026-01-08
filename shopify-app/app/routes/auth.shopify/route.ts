// shopify-app/app/routes/auth.shopify/route.ts
import type { LoaderFunctionArgs } from "react-router";

import { login } from "../../shopify.server";
import { withRequestId, withRequestIdHeader } from "../../utils/request-id.server";
import { validateShopQueryParam } from "../../utils/shop-param.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    // New: config guard (matches story AC)
    if (!process.env.SHOPIFY_API_KEY) {
      return withRequestIdHeader(
        new Response("Missing configuration: SHOPIFY_API_KEY", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
        requestId
      );
    }

    const url = new URL(request.url);
    const result = validateShopQueryParam(url.searchParams.get("shop"));

    // Same as old: missing/invalid -> 400 with clear message
    if (!result.ok) {
      return withRequestIdHeader(
        new Response(result.message, {
          status: result.status,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
        requestId
      );
    }

    // New: direct managed-install by calling Shopify login() on a normalized GET /auth/login URL
    const loginUrl = new URL(request.url);
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("shop", result.shop);
    const appUrl = process.env.SHOPIFY_APP_URL;
    if (!appUrl) {
      return withRequestIdHeader(
        new Response("Missing configuration: SHOPIFY_APP_URL", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
        requestId
      );
    }

    const redirectUri = new URL("/auth/callback", appUrl).toString();
    loginUrl.searchParams.set("redirect_uri", redirectUri);

    const loginRequest = new Request(loginUrl.toString(), {
      method: "GET",
      headers: request.headers,
    });

    try {
      await login(loginRequest);

      // If login() ever returns normally (rare), keep response clean.
      return withRequestIdHeader(new Response(null, { status: 204 }), requestId);
    } catch (err: unknown) {
      // Shopify login typically throws a redirect Response.
      if (err instanceof Response) throw withRequestIdHeader(err, requestId);
      throw err;
    }
  });
};
