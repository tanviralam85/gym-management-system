CREATE TYPE "PlanDurationUnit" AS ENUM ('MONTHS', 'DAYS');

CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "memberNumber" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "address" TEXT,
    "emergencyContact" TEXT,
    "guardianName" TEXT,
    "guardianContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Member_memberNumber_key" ON "Member"("memberNumber");
CREATE INDEX "Member_phone_idx" ON "Member"("phone");

CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationUnit" "PlanDurationUnit" NOT NULL,
    "duration" INTEGER NOT NULL CHECK ("duration" > 0),
    "pricePaise" INTEGER NOT NULL CHECK ("pricePaise" >= 0),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);
