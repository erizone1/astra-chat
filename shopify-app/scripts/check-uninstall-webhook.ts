/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

type EnvKey = "SHOP" | "SHOPIFY_APP_URL" | "SHOPIFY_API_VERSION";

function mustEnv(name: EnvKey): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const prisma = new PrismaClient();

const SHOP = mustEnv("SHOP"); // e.g. astra-chat-dev.myshopify.com
const SHOPIFY_APP_URL = mustEnv("SHOPIFY_APP_URL"); // e.g. https://xxxx.trycloudflare.com
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-04";

const EXPECTED_CALLBACK = new URL(
  "/webhooks/app/uninstalled",
  SHOPIFY_APP_URL
).toString();

const LIST_WEBHOOKS_QUERY = `
  query WebhookSubscriptions($first: Int!, $after: String) {
    webhookSubscriptions(first: $first, after: $after, topics: [APP_UNINSTALLED]) {
      edges {
        cursor
        node {
          id
          topic
          createdAt
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type WebhookEndpoint =
  | { __typename: "WebhookHttpEndpoint"; callbackUrl?: string | null }
  | { __typename: string; [k: string]: unknown }
  | null
  | undefined;

type WebhookSubscriptionNode = {
  id: string;
  topic: string; // expects "APP_UNINSTALLED"
  createdAt: string; // ISO string
  endpoint?: WebhookEndpoint;
};

type WebhookSubscriptionsQueryResponse = {
  data?: {
    webhookSubscriptions?: {
      edges?: Array<{
        cursor?: string | null;
        node?: WebhookSubscriptionNode | null;
      }>;
      pageInfo?: {
        hasNextPage?: boolean | null;
        endCursor?: string | null;
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

async function adminGraphql<T>(
  shop: string,
  apiVersion: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Admin GraphQL failed: ${res.status} ${res.statusText} ${text}`);
  }

  return (await res.json()) as T;
}

function extractCallbackUrl(endpoint?: WebhookEndpoint): string | null {
  if (!endpoint) return null;
  if (endpoint.__typename === "WebhookHttpEndpoint") {
    return endpoint.callbackUrl ?? null;
  }
  return null;
}

async function main(): Promise<void> {
  // 1) Pull offline session for this shop (where the offline access token lives)
  const session = await prisma.session.findFirst({
    where: { shop: SHOP, isOnline: false },
    select: { shop: true, isOnline: true, accessToken: true, scope: true },
  });

  if (!session) {
    throw new Error(
      `No offline session found for ${SHOP}. Install/auth the app first so afterAuth runs.`
    );
  }

  // 2) Query Shopify for APP_UNINSTALLED webhook subscriptions
  const allSubs: WebhookSubscriptionNode[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const payload = await adminGraphql<WebhookSubscriptionsQueryResponse>(
      SHOP,
      API_VERSION,
      session.accessToken,
      LIST_WEBHOOKS_QUERY,
      { first: 100, after: cursor }
    );

    if (payload.errors?.length) {
      throw new Error(
        `Shopify GraphQL errors: ${payload.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join(", ")}`
      );
    }

    const edges = payload.data?.webhookSubscriptions?.edges ?? [];
    for (const edge of edges) {
      if (edge?.node) allSubs.push(edge.node);
    }

    hasNextPage = Boolean(payload.data?.webhookSubscriptions?.pageInfo?.hasNextPage);
    cursor = payload.data?.webhookSubscriptions?.pageInfo?.endCursor ?? null;
  }

  const normalized = allSubs.map((s) => {
    const callbackUrl = extractCallbackUrl(s.endpoint);
    return { id: s.id, topic: s.topic, createdAt: s.createdAt, callbackUrl };
  });

  console.log("\n=== Shopify APP_UNINSTALLED webhook subscriptions ===");
  console.table(normalized);

  const matching = normalized.filter((s) => s.callbackUrl === EXPECTED_CALLBACK);

  console.log("\nExpected callbackUrl:", EXPECTED_CALLBACK);
  console.log("Total APP_UNINSTALLED subs:", normalized.length);
  console.log("Matching expected callbackUrl:", matching.length);

  // 3) Query your DB for Merchant + MerchantWebhook rows
  const merchant = await prisma.merchant.findUnique({
    where: { shopDomain: SHOP },
    select: {
      merchantId: true,
      shopDomain: true,
      status: true,
      statusUpdatedAt: true,
    },
  });

  console.log("\n=== Merchant ===");
  console.log(merchant);

  if (merchant?.merchantId) {
    const dbHooks = await prisma.merchantWebhook.findMany({
      where: { merchantId: merchant.merchantId },
      select: { topic: true, address: true, webhookId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    console.log("\n=== DB MerchantWebhook rows ===");
    console.table(dbHooks);
  } else {
    console.log("\nNo Merchant row found yet for this shopDomain.");
  }

  // 4) Pass/fail guidance
  console.log("\n=== PASS/FAIL checks ===");
  if (matching.length === 1) {
    console.log("✅ PASS: Exactly one uninstall webhook matches expected callbackUrl.");
  } else {
    console.log("❌ FAIL: Expected exactly 1 matching uninstall webhook.");
  }

  if (normalized.length > 1) {
    console.log(
      "⚠️  WARNING: More than 1 APP_UNINSTALLED subscription exists. Consider deleting stale ones."
    );
  }
}

main()
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("\nERROR:", msg);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
