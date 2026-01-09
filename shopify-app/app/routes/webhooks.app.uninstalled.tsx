// app/routes/webhooks.app.uninstalled.tsx
import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildErrorMetadata, logEvent } from "../utils/logger.server";
import {
  getShopifyWebhookHmac,
  getShopifyWebhookShopDomain,
  getShopifyWebhookTopic,
  isExpectedUninstallTopic,
  isValidShopifyWebhookHmac,
  readRawRequestBody,
} from "../utils/shopify-webhook.server";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const started = Date.now();
    const webhookId = request.headers.get("x-shopify-webhook-id") ?? undefined;
    const shopDomainHeader = getShopifyWebhookShopDomain(request) ?? undefined;
    const topicHeader = getShopifyWebhookTopic(request);

    let shopDomain: string | undefined = shopDomainHeader;
    let topicStr: string | undefined = topicHeader ?? undefined;

    const rawBody = await readRawRequestBody(request);
    const hmacHeader = getShopifyWebhookHmac(request);

    if (!isValidShopifyWebhookHmac(rawBody, hmacHeader)) {
      logEvent("Webhook uninstall rejected - invalid HMAC", {
        eventType: "webhook_uninstall",
        outcome: "failure",
        shopDomain,
        durationMs: Date.now() - started,
        topic: topicStr,
        webhookId,
      });

      return withRequestIdHeader(new Response(null, { status: 401 }), requestId);
    }

    if (!isExpectedUninstallTopic(topicHeader)) {
      logEvent("Webhook uninstall rejected - unexpected topic", {
        eventType: "webhook_uninstall",
        outcome: "failure",
        shopDomain,
        durationMs: Date.now() - started,
        topic: topicStr,
        webhookId,
      });

      return withRequestIdHeader(new Response(null, { status: 403 }), requestId);
    }

    try {
      const { shop, topic } = await authenticate.webhook(request);
      shopDomain = shop;
      topicStr = String(topic);

      // ✅ Correct cleanup approach for this template style:
      // Delete sessions and mark merchant as uninstalled in one transaction.
      const { merchantUpdate } = await db.$transaction(async (tx) => {
        const merchantUpdate = await tx.merchant.updateMany({
          where: { shopDomain: shop },
          data: { status: "uninstalled", statusUpdatedAt: new Date() },
        });
        const sessionDelete = await tx.session.deleteMany({ where: { shop } });

        return { merchantUpdate, sessionDelete };
      });

      if (merchantUpdate.count > 0) {
        logEvent("Merchant marked uninstalled", {
          eventType: "webhook_uninstall",
          outcome: "success",
          shopDomain,
          durationMs: Date.now() - started,
          topic: topicStr,
          webhookId,
        });
      }

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
      const errorMeta = buildErrorMetadata(err);
      logEvent("Webhook uninstall failed", {
        eventType: "webhook_uninstall",
        outcome: "failure",
        shopDomain,
        durationMs: Date.now() - started,
        topic: topicStr,
        webhookId,
        ...errorMeta,
      });

      // keep 500 so Shopify retries on real failures
      return withRequestIdHeader(new Response(null, { status: 500 }), requestId);
    }
  });
};
