CREATE TABLE "Merchant" (
    "merchantId" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL
);

CREATE UNIQUE INDEX "Merchant_shopDomain_key" ON "Merchant"("shopDomain");
