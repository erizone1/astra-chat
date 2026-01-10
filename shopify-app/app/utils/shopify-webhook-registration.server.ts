import prisma from "../db.server";
import { logger } from "./logger.server";

const UNINSTALL_TOPIC = "APP_UNINSTALLED";
const UNINSTALL_CALLBACK_PATH = "/webhooks/app/uninstalled";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
};

type WebhookEndpoint = {
  __typename?: string;
  callbackUrl?: string | null;
};

type WebhookSubscription = {
  id: string;
  topic: string;
  createdAt: string;
  endpoint?: WebhookEndpoint | null;
};

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

const CREATE_WEBHOOK_MUTATION = `
  mutation WebhookSubscriptionCreate($callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: APP_UNINSTALLED
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      webhookSubscription {
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
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_WEBHOOK_MUTATION = `
  mutation WebhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors {
        field
        message
      }
    }
  }
`;

function getCallbackUrl(): string {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    throw new Error("Missing configuration: SHOPIFY_APP_URL");
  }

  return new URL(UNINSTALL_CALLBACK_PATH, appUrl).toString();
}

async function fetchWebhookSubscriptions(
  admin: AdminGraphqlClient
): Promise<WebhookSubscription[]> {
  const results: WebhookSubscription[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await admin.graphql(LIST_WEBHOOKS_QUERY, {
      variables: {
        first: 100,
        after: cursor,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch webhook subscriptions (status ${response.status}).`
      );
    }

    const payload = (await response.json()) as {
      data?: {
        webhookSubscriptions?: {
          edges?: Array<{ cursor?: string; node?: WebhookSubscription }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(
        `Failed to fetch webhook subscriptions: ${payload.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(", ")}`
      );
    }

    const edges = payload.data?.webhookSubscriptions?.edges ?? [];
    for (const edge of edges) {
      if (edge.node) {
        results.push(edge.node);
      }
    }

    hasNextPage = Boolean(payload.data?.webhookSubscriptions?.pageInfo?.hasNextPage);
    cursor = payload.data?.webhookSubscriptions?.pageInfo?.endCursor ?? null;
  }

  return results;
}

async function createWebhookSubscription(
  admin: AdminGraphqlClient,
  callbackUrl: string
): Promise<WebhookSubscription> {
  const response = await admin.graphql(CREATE_WEBHOOK_MUTATION, {
    variables: { callbackUrl },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create webhook subscription (status ${response.status}).`
    );
  }

  const payload = (await response.json()) as {
    data?: {
      webhookSubscriptionCreate?: {
        webhookSubscription?: WebhookSubscription | null;
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      `Failed to create webhook subscription: ${payload.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(", ")}`
    );
  }

  const userErrors = payload.data?.webhookSubscriptionCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `Failed to create webhook subscription: ${userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join(", ")}`
    );
  }

  const webhook = payload.data?.webhookSubscriptionCreate?.webhookSubscription;
  if (!webhook) {
    throw new Error("Webhook subscription creation returned no webhook.");
  }

  return webhook;
}

async function deleteWebhookSubscription(
  admin: AdminGraphqlClient,
  id: string
): Promise<void> {
  const response = await admin.graphql(DELETE_WEBHOOK_MUTATION, {
    variables: { id },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to delete webhook subscription ${id} (status ${response.status}).`
    );
  }

  const payload = (await response.json()) as {
    data?: {
      webhookSubscriptionDelete?: {
        deletedWebhookSubscriptionId?: string | null;
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      `Failed to delete webhook subscription: ${payload.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(", ")}`
    );
  }

  const userErrors = payload.data?.webhookSubscriptionDelete?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `Failed to delete webhook subscription: ${userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join(", ")}`
    );
  }
}

async function persistWebhookMetadata(params: {
  merchantId: string;
  webhook: WebhookSubscription;
  callbackUrl: string;
}) {
  await prisma.merchantWebhook.deleteMany({
    where: {
      merchantId: params.merchantId,
      topic: params.webhook.topic,
      address: { not: params.callbackUrl },
    },
  });

  await prisma.merchantWebhook.upsert({
    where: {
      merchantId_topic_address: {
        merchantId: params.merchantId,
        topic: params.webhook.topic,
        address: params.callbackUrl,
      },
    },
    create: {
      merchantId: params.merchantId,
      topic: params.webhook.topic,
      address: params.callbackUrl,
      webhookId: params.webhook.id,
      createdAt: new Date(params.webhook.createdAt),
    },
    update: {
      webhookId: params.webhook.id,
      createdAt: new Date(params.webhook.createdAt),
    },
  });
}

export async function ensureUninstallWebhookRegistration(params: {
  admin: AdminGraphqlClient;
  merchantId: string;
  shopDomain: string;
}): Promise<{ success: boolean; webhookId?: string }> {
  const callbackUrl = getCallbackUrl();

  try {
    const subscriptions = await fetchWebhookSubscriptions(params.admin);
    const matching = subscriptions.filter((subscription) => {
      const endpoint = subscription.endpoint;
      const callbackUrlValue =
        endpoint?.__typename === "WebhookHttpEndpoint" ? endpoint?.callbackUrl : null;
      return subscription.topic === UNINSTALL_TOPIC && callbackUrlValue === callbackUrl;
    });
    const nonMatching = subscriptions.filter((subscription) => {
      const endpoint = subscription.endpoint;
      const callbackUrlValue =
        endpoint?.__typename === "WebhookHttpEndpoint" ? endpoint?.callbackUrl : null;
      return !(
        subscription.topic === UNINSTALL_TOPIC && callbackUrlValue === callbackUrl
      );
    });

    let primarySubscription = matching[0];

    if (!primarySubscription) {
      primarySubscription = await createWebhookSubscription(
        params.admin,
        callbackUrl
      );
      logger.info("webhook.uninstall.created", {
        shopDomain: params.shopDomain,
        webhookId: primarySubscription.id,
      });
    }

    const duplicates = matching.slice(1);
    const cleanupTargets = [...duplicates, ...nonMatching];
    for (const subscription of cleanupTargets) {
      await deleteWebhookSubscription(params.admin, subscription.id);
      logger.info("webhook.uninstall.deleted_duplicate", {
        shopDomain: params.shopDomain,
        webhookId: subscription.id,
      });
    }

    await persistWebhookMetadata({
      merchantId: params.merchantId,
      webhook: primarySubscription,
      callbackUrl,
    });

    return { success: true, webhookId: primarySubscription.id };
  } catch (err: unknown) {
    logger.error("webhook.uninstall.registration_failed", {
      shopDomain: params.shopDomain,
      merchantId: params.merchantId,
      errorName: err instanceof Error ? err.name : "Error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { success: false };
  }
}
