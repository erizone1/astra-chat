import type { Session } from "@shopify/shopify-api";

import prisma from "../db.server";

type AdminGraphqlClient = {
  graphql: (query: string) => Promise<Response>;
};

type MerchantIdentity = {
  merchantId: string;
  shopDomain: string;
  scopes: string;
};

function normalizeShopId(value?: string | number | null): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "number") return value.toString();

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(/(\d+)$/);
  return match ? match[1] : undefined;
}

async function resolveMerchantIdentity(
  session: Session,
  admin?: AdminGraphqlClient
): Promise<MerchantIdentity> {
  let merchantId = normalizeShopId(session.shopId);
  let shopDomain = session.shop;

  if ((!merchantId || !shopDomain) && admin) {
    const response = await admin.graphql(`
      {
        shop {
          id
          myshopifyDomain
        }
      }
    `);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch shop identity from Shopify (status ${response.status}).`
      );
    }

    const payload = (await response.json()) as {
      data?: { shop?: { id?: string; myshopifyDomain?: string } };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(
        `Failed to fetch shop identity from Shopify: ${payload.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(", ")}`
      );
    }

    merchantId = merchantId ?? normalizeShopId(payload.data?.shop?.id);
    shopDomain = shopDomain ?? payload.data?.shop?.myshopifyDomain;
  }

  if (!merchantId) {
    throw new Error("Missing Shopify shop ID for merchant provisioning.");
  }

  if (!shopDomain) {
    throw new Error("Missing Shopify shop domain for merchant provisioning.");
  }

  return {
    merchantId,
    shopDomain,
    scopes: session.scope ?? "",
  };
}

export async function upsertActiveMerchant(
  session: Session,
  admin?: AdminGraphqlClient
) {
  const { merchantId, shopDomain, scopes } = await resolveMerchantIdentity(
    session,
    admin
  );

  return prisma.merchant.upsert({
    where: { merchantId },
    create: {
      merchantId,
      shopDomain,
      installedAt: new Date(),
      scopes,
      status: "active",
    },
    update: {
      shopDomain,
      installedAt: new Date(),
      scopes,
      status: "active",
    },
  });
}
