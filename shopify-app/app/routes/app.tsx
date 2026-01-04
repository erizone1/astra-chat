import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { logger } from "../utils/logger.server";
import { withRequestId } from "../utils/request-id.server";

type AdminAuthResultShape = {
  session?: { shop?: string };
  admin?: { session?: { shop?: string } };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async () => {
    const url = new URL(request.url);

    logger.info("embedded.auth.start", {
      path: url.pathname,
      method: request.method,
    });

    try {
      const authResult = await authenticate.admin(request);

      // Avoid `any` (lint): cast to a narrow expected shape
      const ar = authResult as unknown as AdminAuthResultShape;

      const shop =
        ar.session?.shop ??
        ar.admin?.session?.shop ??
        url.searchParams.get("shop") ??
        undefined;

      logger.info("embedded.auth.ok", {
        path: url.pathname,
        shop,
      });

      // eslint-disable-next-line no-undef
      return { apiKey: process.env.SHOPIFY_API_KEY || "" };
    } catch (err) {
      // Shopify auth can throw a Response (e.g., 410 / redirects in embedded flows)
      if (err instanceof Response) {
        logger.info("embedded.auth.thrown_response", {
          path: url.pathname,
          status: err.status,
        });
        throw err;
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
