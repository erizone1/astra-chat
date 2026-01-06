// app/routes/auth.login/route.tsx
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import { logEvent } from "../../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../../utils/request-id.server";

// Accept LoginErrorMessage (and any other object-shape) without requiring an index signature.
function hasAnyErrors(errors: unknown): boolean {
  if (!errors || typeof errors !== "object") return false;

  // Safely treat it like a dictionary for the purpose of scanning values
  const dict = errors as Record<string, unknown>;
  return Object.values(dict).some((v) => Boolean(v));
}


function looksLikeOAuthCallback(url: URL): boolean {
  // Don’t log values; just detect callback shape.
  // Shopify OAuth callback typically includes code/hmac/state.
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
    const shopDomain = url.searchParams.get("shop") ?? undefined;

    const isCallback = looksLikeOAuthCallback(url);

    try {
      const result = await login(request);
      const errors = loginErrorMessage(result);

      // Only emit oauth_callback logs when it actually looks like callback traffic
      if (isCallback) {
        const failure = hasAnyErrors(errors);
        logEvent(failure ? "OAuth callback failed" : "OAuth callback processed", {
          eventType: "oauth_callback",
          outcome: failure ? "failure" : "success",
          shopDomain,
          durationMs: Date.now() - started,
        });
      }

      return { errors };
    } catch (err: unknown) {
      // If Shopify completes auth/callback with redirects, treat as success and preserve requestId header
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

      // Real error during callback handling
      if (isCallback) {
        logEvent("OAuth callback failed", {
          eventType: "oauth_callback",
          outcome: "failure",
          shopDomain,
          durationMs: Date.now() - started,
          errorName: err instanceof Error ? err.name : "Error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }

      throw err;
    }
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const started = Date.now();

    // Extract shopDomain from form safely (clone avoids consuming the body)
    let shopDomain: string | undefined;
    try {
      const form = await request.clone().formData();
      const shop = form.get("shop");
      if (typeof shop === "string" && shop.trim()) shopDomain = shop.trim();
    } catch {
      // ignore
    }

    try {
      const result = await login(request);
      const errors = loginErrorMessage(result);

      const failure = hasAnyErrors(errors);

      logEvent(failure ? "OAuth start failed" : "OAuth started", {
        eventType: "oauth_start",
        outcome: failure ? "failure" : "success",
        shopDomain,
        durationMs: Date.now() - started,
      });

      return { errors };
    } catch (err: unknown) {
      // OAuth start often redirects out to Shopify; treat redirect as success and preserve requestId header
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

      logEvent("OAuth start failed", {
        eventType: "oauth_start",
        outcome: "failure",
        shopDomain,
        durationMs: Date.now() - started,
        errorName: err instanceof Error ? err.name : "Error",
        errorMessage: err instanceof Error ? err.message : String(err),
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

