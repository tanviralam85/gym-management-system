-- CreateEnum
CREATE TYPE "OwnerAdjustmentKind" AS ENUM ('CORRECTION', 'BACKDATE', 'REFUND', 'CANCELLATION');

-- CreateTable
CREATE TABLE "OwnerAdjustment" (
    "id" TEXT NOT NULL,
    "kind" "OwnerAdjustmentKind" NOT NULL,
    "memberId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalReceiptNumber" INTEGER,
    "replacementReceiptNumber" INTEGER,
    "backdatedReceiptNumber" INTEGER,
    "canceledPurchaseId" TEXT,

    CONSTRAINT "OwnerAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationReversal" (
    "adjustmentId" TEXT NOT NULL,
    "receiptNumber" INTEGER NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "returnMethod" "PaymentMethod",
    "returnReference" TEXT,

    CONSTRAINT "AllocationReversal_pkey" PRIMARY KEY ("adjustmentId","receiptNumber","chargeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAdjustment_originalReceiptNumber_key" ON "OwnerAdjustment"("originalReceiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAdjustment_replacementReceiptNumber_key" ON "OwnerAdjustment"("replacementReceiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAdjustment_backdatedReceiptNumber_key" ON "OwnerAdjustment"("backdatedReceiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAdjustment_canceledPurchaseId_key" ON "OwnerAdjustment"("canceledPurchaseId");

-- CreateIndex
CREATE INDEX "OwnerAdjustment_memberId_createdAt_idx" ON "OwnerAdjustment"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "AllocationReversal_receiptNumber_chargeId_idx" ON "AllocationReversal"("receiptNumber", "chargeId");

-- AddForeignKey
ALTER TABLE "OwnerAdjustment" ADD CONSTRAINT "OwnerAdjustment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAdjustment" ADD CONSTRAINT "OwnerAdjustment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAdjustment" ADD CONSTRAINT "OwnerAdjustment_originalReceiptNumber_fkey" FOREIGN KEY ("originalReceiptNumber") REFERENCES "Payment"("receiptNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAdjustment" ADD CONSTRAINT "OwnerAdjustment_replacementReceiptNumber_fkey" FOREIGN KEY ("replacementReceiptNumber") REFERENCES "Payment"("receiptNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAdjustment" ADD CONSTRAINT "OwnerAdjustment_backdatedReceiptNumber_fkey" FOREIGN KEY ("backdatedReceiptNumber") REFERENCES "Payment"("receiptNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAdjustment" ADD CONSTRAINT "OwnerAdjustment_canceledPurchaseId_fkey" FOREIGN KEY ("canceledPurchaseId") REFERENCES "MembershipPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReversal" ADD CONSTRAINT "AllocationReversal_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "OwnerAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReversal" ADD CONSTRAINT "AllocationReversal_receiptNumber_chargeId_fkey" FOREIGN KEY ("receiptNumber", "chargeId") REFERENCES "PaymentAllocation"("receiptNumber", "chargeId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AllocationReversal" ADD CONSTRAINT "reversal_positive_amount" CHECK ("amountPaise" > 0);
