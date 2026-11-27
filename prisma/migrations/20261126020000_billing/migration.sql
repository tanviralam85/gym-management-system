-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI');

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('MEMBERSHIP', 'OPENING_DUES');

-- CreateTable
CREATE TABLE "MembershipPurchase" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "durationUnit" "PlanDurationUnit" NOT NULL,
    "duration" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "anchorDay" INTEGER NOT NULL,
    "businessDate" DATE NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberCharge" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "kind" "ChargeKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "businessDate" DATE NOT NULL,
    "dueDate" DATE,

    CONSTRAINT "MemberCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "receiptNumber" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "memberNumber" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "balancePaise" BIGINT NOT NULL,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("receiptNumber")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "receiptNumber" INTEGER NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("receiptNumber","chargeId")
);

-- CreateTable
CREATE TABLE "BillingOperation" (
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingOperation_pkey" PRIMARY KEY ("actorId","key")
);

-- CreateIndex
CREATE INDEX "MembershipPurchase_memberId_expiresOn_idx" ON "MembershipPurchase"("memberId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCharge_purchaseId_key" ON "MemberCharge"("purchaseId");

-- CreateIndex
CREATE INDEX "MemberCharge_memberId_businessDate_id_idx" ON "MemberCharge"("memberId", "businessDate", "id");

-- CreateIndex
CREATE INDEX "Payment_memberId_receiptNumber_idx" ON "Payment"("memberId", "receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_businessDate_actorId_method_idx" ON "Payment"("businessDate", "actorId", "method");

-- CreateIndex
CREATE INDEX "PaymentAllocation_chargeId_idx" ON "PaymentAllocation"("chargeId");

-- AddForeignKey
ALTER TABLE "MembershipPurchase" ADD CONSTRAINT "MembershipPurchase_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPurchase" ADD CONSTRAINT "MembershipPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPurchase" ADD CONSTRAINT "MembershipPurchase_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MembershipPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_receiptNumber_fkey" FOREIGN KEY ("receiptNumber") REFERENCES "Payment"("receiptNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "MemberCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingOperation" ADD CONSTRAINT "BillingOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MembershipPurchase" ADD CONSTRAINT "purchase_valid_terms"
    CHECK ("pricePaise" >= 0 AND "duration" > 0 AND "startsOn" <= "expiresOn" AND "anchorDay" BETWEEN 1 AND 31);
ALTER TABLE "MemberCharge" ADD CONSTRAINT "charge_valid_amount_and_source"
    CHECK ("amountPaise" >= 0 AND (("kind" = 'MEMBERSHIP') = ("purchaseId" IS NOT NULL)));
ALTER TABLE "Payment" ADD CONSTRAINT "payment_valid_amounts"
    CHECK ("amountPaise" > 0 AND "balancePaise" >= 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "allocation_positive_amount"
    CHECK ("amountPaise" > 0);

