import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { buildErrorMetadata, logger, withEventLogging } from "../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

type AdminAuthResultShape = {
  session?: { shop?: string };
  admin?: { session?: { shop?: string } };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") ?? undefined;

    logger.info("embedded.auth.start", {
      path: url.pathname,
      method: request.method,
      shopDomain,
    });

    try {
      // Log exactly once with accurate outcome for the session exchange.
      const authResult = await withEventLogging({
        eventType: "session_exchange",
        message: "Admin session exchange",
        shopDomain,
        run: async () => {
          return await authenticate.admin(request);
        },
      });

      // Avoid `any` (lint): cast to a narrow expected shape
      const ar = authResult as unknown as AdminAuthResultShape;

      const shop =
        ar.session?.shop ??
        ar.admin?.session?.shop ??
        shopDomain ??
        undefined;

      logger.info("embedded.auth.ok", {
        path: url.pathname,
        shop,
      });

      // If the auth layer threw a Response we already handle it in catch.
      // For normal success, return the API key for AppProvider.
      return { apiKey: process.env.SHOPIFY_API_KEY || "" };
    } catch (err: unknown) {
      // Shopify auth can throw a Response (e.g., redirects / 410 / etc.)
      if (err instanceof Response) {
        logger.info("embedded.auth.thrown_response", {
          path: url.pathname,
          status: err.status,
          shopDomain,
        });
        throw withRequestIdHeader(err, requestId);
      }

      logger.error("embedded.auth.fail", {
        eventType: "session_exchange",
        path: url.pathname,
        shopDomain,
        ...(process.env.NODE_ENV === "production"
          ? buildErrorMetadata(err)
          : {
              ...buildErrorMetadata(err),
              stack: err instanceof Error ? err.stack : undefined,
            }),
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
