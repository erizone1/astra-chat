// app/routes/webhooks.app.scopes_update.tsx
import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logEvent } from "../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

// Narrow type for the webhook payload we care about (no `any`)
type ScopesUpdateWebhookPayload = {
  current?: unknown;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const started = Date.now();

    // Safe, header-level identifiers (no payload logging)
    const webhookId = request.headers.get("x-shopify-webhook-id") ?? undefined;

    try {
      const { payload, session, topic, shop } = await authenticate.webhook(request);

      // Extract scopes safely (no `any`)
      const currentRaw = (payload as ScopesUpdateWebhookPayload | null | undefined)?.current;
      const currentScopes: string[] = Array.isArray(currentRaw)
        ? currentRaw.filter((s): s is string => typeof s === "string")
        : [];

      if (session) {
        await db.session.update({
          where: { id: session.id },
          data: {
            scope: currentScopes.toString(),
          },
        });
      }

      // Log success ONLY after DB update finishes (or is skipped safely)
      logEvent("Webhook scopes update processed", {
        eventType: "webhook_other",
        outcome: "success",
        shopDomain: shop,
        durationMs: Date.now() - started,
        status: 200,
        topic: String(topic),
        webhookId,
        hadSession: Boolean(session),
        scopeCount: currentScopes.length,
        updatedDb: Boolean(session),
      });

      return withRequestIdHeader(new Response(null, { status: 200 }), requestId);
    } catch (err: unknown) {
      // If Shopify auth throws a Response, preserve request id header for correlation.
      if (err instanceof Response) {
        throw withRequestIdHeader(err, requestId);
      }

      logEvent("Webhook scopes update failed", {
        eventType: "webhook_other",
        outcome: "failure",
        durationMs: Date.now() - started,
        status: 500,
        webhookId,
        errorName: err instanceof Error ? err.name : "Error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      return withRequestIdHeader(new Response(null, { status: 500 }), requestId);
    }
  });
};

