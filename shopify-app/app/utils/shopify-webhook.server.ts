import crypto from "crypto";

const SHOPIFY_UNINSTALL_TOPIC = "app/uninstalled";

export const getShopifyWebhookTopic = (request: Request) =>
  request.headers.get("X-Shopify-Topic");

export const getShopifyWebhookShopDomain = (request: Request) =>
  request.headers.get("X-Shopify-Shop-Domain");

export const isExpectedUninstallTopic = (topic: string | null) =>
  topic === SHOPIFY_UNINSTALL_TOPIC;

export const readRawRequestBody = async (request: Request) => {
  const arrayBuffer = await request.clone().arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const isValidShopifyWebhookHmac = (rawBody: Buffer, hmacHeader: string | null) => {
  if (!hmacHeader) return false;
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const computedBuffer = Buffer.from(computed, "base64");
  const providedBuffer = Buffer.from(hmacHeader, "base64");

  if (computedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(computedBuffer, providedBuffer);
};

export const getShopifyWebhookHmac = (request: Request) =>
  request.headers.get("X-Shopify-Hmac-Sha256");
