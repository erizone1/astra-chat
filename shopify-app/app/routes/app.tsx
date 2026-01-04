import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { logger } from "../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const url = new URL(request.url);

    logger.info("embedded.auth.start", {
      path: url.pathname,
      method: request.method,
    });

    try {
      const authResult = await authenticate.admin(request);

      // authResult shape can vary by template/version; we log only what’s safely available
      const shop =
        (authResult as any)?.session?.shop ??
        (authResult as any)?.admin?.session?.shop ??
        url.searchParams.get("shop") ??
        undefined;

      logger.info("embedded.auth.ok", {
        path: url.pathname,
        shop,
      });

      // eslint-disable-next-line no-undef
      return { apiKey: process.env.SHOPIFY_API_KEY || "" };
    } catch (err) {
      // Shopify auth commonly throws a Response (redirect) as normal flow.
      // Attach request id header to that thrown response and rethrow.
      if (err instanceof Response) {
        logger.info("embedded.auth.thrown_response", {
          path: url.pathname,
          status: err.status,
          location: err.headers.get("location") ?? undefined,
        });
        throw withRequestIdHeader(err, requestId);
      }

      logger.error("embedded.auth.fail", {
        path: url.pathname,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

