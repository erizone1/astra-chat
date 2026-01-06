// app/routes/webhooks.app.uninstalled.tsx
import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logEvent } from "../utils/logger.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const started = Date.now();
    const webhookId = request.headers.get("x-shopify-webhook-id") ?? undefined;

    let shopDomain: string | undefined;
    let topicStr: string | undefined;

    try {
      const { shop, topic } = await authenticate.webhook(request);
      shopDomain = shop;
      topicStr = String(topic);

      // ✅ Correct cleanup approach for this template style:
      // Delete sessions from your DB for this shop.
      await db.session.deleteMany({ where: { shop } });

      logEvent("Webhook uninstall processed", {
        eventType: "webhook_uninstall",
        outcome: "success",
        shopDomain,
        durationMs: Date.now() - started,
        topic: topicStr,
        webhookId,
      });

      return withRequestIdHeader(new Response(null, { status: 200 }), requestId);
    } catch (err: unknown) {
      logEvent("Webhook uninstall failed", {
        eventType: "webhook_uninstall",
        outcome: "failure",
        shopDomain,
        durationMs: Date.now() - started,
        topic: topicStr,
        webhookId,
        errorName: err instanceof Error ? err.name : "Error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      // keep 500 so Shopify retries on real failures
      return withRequestIdHeader(new Response(null, { status: 500 }), requestId);
    }
  });
};
