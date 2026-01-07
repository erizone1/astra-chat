// shopify-app/app/routes/auth.login/route.tsx
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorCode, loginErrorMessage } from "./error.server";

import { buildErrorMetadata, logEvent } from "../../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../../utils/request-id.server";
import { normalizeShopDomain } from "../../utils/shop-param.server";

// Accept LoginErrorMessage (and any other object-shape) without requiring an index signature.
function hasAnyErrors(errors: unknown): boolean {
  if (!errors || typeof errors !== "object") return false;
  const dict = errors as Record<string, unknown>;
  return Object.values(dict).some((v) => Boolean(v));
}

function looksLikeOAuthCallback(url: URL): boolean {
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("hmac") ||
    url.searchParams.has("state")
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const started = Date.now();
    const url = new URL(request.url);

    const rawShop = url.searchParams.get("shop");
    const shopDomain = normalizeShopDomain(rawShop);

    const isCallback = looksLikeOAuthCallback(url);

    // Keep the login UI available when no shop is provided (do not break existing functionality)
    if (request.method === "GET" && !rawShop) {
      return { errors: {} };
    }

    // Config guard (AC: clear error, no redirect)
    if (request.method === "GET" && rawShop && !process.env.SHOPIFY_API_KEY) {
      return withRequestIdHeader(
        new Response("Missing configuration: SHOPIFY_API_KEY", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
        requestId
      );
    }

    try {
      const result = await login(request);
      const errors = loginErrorMessage(result);
      const errorCode = loginErrorCode(result);

      if (isCallback) {
        const failure = hasAnyErrors(errors);
        logEvent(failure ? "OAuth callback failed" : "OAuth callback processed", {
          eventType: "oauth_callback",
          outcome: failure ? "failure" : "success",
          shopDomain,
          durationMs: Date.now() - started,
          ...(failure && errorCode ? { errorCode, errorMessage: "Invalid shop domain" } : {}),
        });
      }

      return { errors };
    } catch (err: unknown) {
      if (err instanceof Response) {
        if (isCallback) {
          logEvent("OAuth callback processed", {
            eventType: "oauth_callback",
            outcome: "success",
            shopDomain,
            durationMs: Date.now() - started,
            status: err.status,
            redirect: true,
          });
        }
        throw withRequestIdHeader(err, requestId);
      }

      if (isCallback) {
        const errorMeta = buildErrorMetadata(err);
        logEvent("OAuth callback failed", {
          eventType: "oauth_callback",
          outcome: "failure",
          shopDomain,
          durationMs: Date.now() - started,
          ...errorMeta,
        });
      }

      throw err;
    }
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const started = Date.now();

    let shopDomain: string | undefined;
    try {
      const form = await request.clone().formData();
      const shop = form.get("shop");
      if (typeof shop === "string") shopDomain = normalizeShopDomain(shop);
    } catch {
      // ignore
    }

    try {
      const result = await login(request);
      const errors = loginErrorMessage(result);
      const errorCode = loginErrorCode(result);

      const failure = hasAnyErrors(errors);

      logEvent(failure ? "OAuth start failed" : "OAuth started", {
        eventType: "oauth_start",
        outcome: failure ? "failure" : "success",
        shopDomain,
        durationMs: Date.now() - started,
        ...(failure && errorCode ? { errorCode, errorMessage: "Invalid shop domain" } : {}),
      });

      return { errors };
    } catch (err: unknown) {
      if (err instanceof Response) {
        logEvent("OAuth started", {
          eventType: "oauth_start",
          outcome: "success",
          shopDomain,
          durationMs: Date.now() - started,
          status: err.status,
          redirect: true,
        });
        throw withRequestIdHeader(err, requestId);
      }

      const errorMeta = buildErrorMetadata(err);
      logEvent("OAuth start failed", {
        eventType: "oauth_start",
        outcome: "failure",
        shopDomain,
        durationMs: Date.now() - started,
        ...errorMeta,
      });

      throw err;
    }
  });
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}

