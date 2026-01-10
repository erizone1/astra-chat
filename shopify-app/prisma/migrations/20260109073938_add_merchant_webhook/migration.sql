-- CreateTable
CREATE TABLE "MerchantWebhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "MerchantWebhook_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("merchantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantWebhook_merchantId_topic_address_key" ON "MerchantWebhook"("merchantId", "topic", "address");
