// app/routes/auth.login.callback/route.ts
import type { LoaderFunctionArgs } from "react-router";

import shopify from "../../shopify.server";
import { withEventLogging } from "../../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../../utils/request-id.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return withRequestId(request, async (requestId) => {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") ?? undefined;

    try {
      await withEventLogging({
        eventType: "oauth_callback",
        message: "OAuth callback received",
        shopDomain,
        run: async () => {
          await shopify.authenticate.admin(request);
        },
      });

      // If authenticate.admin() doesn't redirect (rare, but possible), respond cleanly.
      return withRequestIdHeader(new Response(null, { status: 204 }), requestId);
    } catch (err: unknown) {
      // OAuth flow often throws redirect Response; preserve request id header for correlation.
      if (err instanceof Response) throw withRequestIdHeader(err, requestId);
      throw err;
    }
  });
}

