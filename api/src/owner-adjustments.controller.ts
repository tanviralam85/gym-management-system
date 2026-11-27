import { BadRequestException, Body, ConflictException, Controller, Get, Header, HttpCode,
  Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Account, PaymentMethod, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { SameOriginGuard } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { matchesPassword } from './auth/credentials.js';
import { businessDate, date, day, getMember, hash, lockOperation, memberNumber, openCharges,
  outstandingAllocation, receiptInclude, receiptView, validDate, validKey } from './billing.controller.js';

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

function readAdjustment(body: Record<string, unknown>) {
  const { kind, amountPaise, businessOn, receiptNumber, chargeId, purchaseId, method, reason, reference } = body ?? {};
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500 ||
      (reference != null && (typeof reference !== 'string' || reference.trim().length > 100))) {
    throw new BadRequestException('Enter a reason and a valid optional reference.');
  }
  const details = { reason: reason.trim(), reference: typeof reference === 'string' ? reference.trim() || null : null };
  if (kind === 'CORRECTION' && positiveInt(receiptNumber) && positiveInt(amountPaise)) {
    return { ...details, kind, receiptNumber, amountPaise } as const;
  }
  if (kind === 'BACKDATE' && positiveInt(amountPaise) && (method === 'CASH' || method === 'UPI') &&
      typeof businessOn === 'string' && validDate(businessOn)) {
    return { ...details, kind, amountPaise, method, businessOn } as const;
  }
  if (kind === 'REFUND' && positiveInt(receiptNumber) && positiveInt(chargeId) &&
      positiveInt(amountPaise) && (method === 'CASH' || method === 'UPI')) {
    return { ...details, kind, receiptNumber, chargeId, amountPaise, method } as const;
  }
  if (kind === 'CANCELLATION' && typeof purchaseId === 'string' && /^[\w-]{1,64}$/.test(purchaseId)) {
    return { ...details, kind, purchaseId } as const;
  }
  throw new BadRequestException('Check the adjustment details.');
}

type Adjustment = ReturnType<typeof readAdjustment>;
type UndoAllocation = { receiptNumber: number; chargeId: number; label: string; amountPaise: number;
  returnMethod: PaymentMethod | null; returnReference: string | null };
type NewPayment = { amountPaise: number; method: PaymentMethod; reference: string | null;
  businessOn: string; actorId: string; actorUsername: string;
  allocations: { chargeId: number; label: string; amountPaise: number }[] };
const eligibleAllocations = { include: { charge: { select: { label: true } },
  reversals: { select: { amountPaise: true } } }, orderBy: { chargeId: 'asc' } } as const;
const adjustmentHistory = { owner: { select: { username: true } },
  canceledPurchase: { select: { planName: true } },
  reversals: { select: { amountPaise: true, receiptNumber: true, returnMethod: true, returnReference: true },
    orderBy: [{ receiptNumber: 'asc' }, { chargeId: 'asc' }] },
} satisfies Prisma.OwnerAdjustmentInclude;

@Controller('billing/owner/members/:number')
@UseGuards(SameOriginGuard, ThrottlerGuard)
export class OwnerAdjustmentsController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async options(@Req() request: Request, @Param('number') number: string) {
    await this.auth.requireOwner(request);
    const member = await getMember(this.auth.db, memberNumber(number));
    const payments = await this.auth.db.payment.findMany({ where: { memberId: member.id, supersededBy: null },
      orderBy: { receiptNumber: 'desc' }, include: { allocations: eligibleAllocations } });
    const history = await this.auth.db.ownerAdjustment.findMany({ where: { memberId: member.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, include: adjustmentHistory });
    return { payments: payments.map((payment) => ({
      receiptNumber: payment.receiptNumber, amountPaise: payment.amountPaise, method: payment.method,
      businessOn: day(payment.businessDate), correctable: payment.allocations.every((row) => !row.reversals.length),
      allocations: payment.allocations.map((row) => ({
        chargeId: row.chargeId, label: row.charge.label, refundablePaise: outstandingAllocation(row),
      })).filter((row) => row.refundablePaise > 0),
    })), history: history.map(({ id, kind, reason, owner, createdAt, canceledPurchase,
      businessDate, originalReceiptNumber, replacementReceiptNumber, backdatedReceiptNumber, reversals }) => ({
      id, kind, reason, owner: owner.username, recordedAt: createdAt.toISOString(), businessOn: day(businessDate),
      originalReceiptNumber, replacementReceiptNumber, backdatedReceiptNumber, canceledPlan: canceledPurchase?.planName,
      returns: reversals.filter((line) => line.returnMethod !== null),
    })) };
  }

  private async prepare(tx: Prisma.TransactionClient, memberId: string, owner: Account, input: Adjustment) {
    const today = businessDate();
    const charges = await openCharges(tx, memberId);
    const balanceBefore = charges.reduce((sum, row) => sum + row.balancePaise, 0);
    const reversals: UndoAllocation[] = [];
    let newPayment: NewPayment | null = null;
    let original = null;
    let cancellation = null;
    let balanceAfter = balanceBefore;
    const allocate = (amountPaise: number, open: typeof charges) => {
      let remaining = amountPaise;
      const applications = [];
      for (const charge of open) {
        if (!remaining) break;
        const applied = Math.min(remaining, charge.balancePaise);
        applications.push({ chargeId: charge.id, label: charge.label, amountPaise: applied });
        remaining -= applied;
      }
      if (remaining) throw new BadRequestException('The amount exceeds the outstanding balance.');
      return applications;
    };
    if (input.kind === 'CORRECTION' || input.kind === 'REFUND') {
      const payment = await tx.payment.findFirst({ where: {
        memberId, receiptNumber: input.receiptNumber, supersededBy: null,
      }, include: { allocations: eligibleAllocations } });
      if (!payment) throw new ConflictException('This receipt is no longer eligible.');
      original = { receiptNumber: payment.receiptNumber, amountPaise: payment.amountPaise,
        businessOn: day(payment.businessDate), actor: payment.actorUsername, method: payment.method };
      if (input.kind === 'CORRECTION') {
        if (input.amountPaise === payment.amountPaise) throw new BadRequestException('Enter a different corrected amount.');
        if (payment.allocations.some((row) => row.reversals.length)) {
          throw new ConflictException('This receipt already has refunded allocations and cannot be corrected here.');
        }
        const restored = new Map<number, number>();
        for (const row of payment.allocations) {
          restored.set(row.chargeId, row.amountPaise);
          reversals.push({ receiptNumber: payment.receiptNumber, chargeId: row.chargeId, label: row.charge.label,
            amountPaise: row.amountPaise, returnMethod: null, returnReference: null });
        }
        const reopened = await openCharges(tx, memberId, restored);
        newPayment = { amountPaise: input.amountPaise, method: payment.method,
          reference: input.reference ?? payment.reference, businessOn: original.businessOn,
          actorId: payment.actorId, actorUsername: payment.actorUsername, allocations: allocate(input.amountPaise, reopened) };
        balanceAfter += payment.amountPaise - input.amountPaise;
      } else {
        const row = payment.allocations.find((allocation) => allocation.chargeId === input.chargeId);
        if (!row || outstandingAllocation(row) < input.amountPaise) {
          throw new ConflictException('The refund exceeds the amount still applied to this charge.');
        }
        reversals.push({ receiptNumber: payment.receiptNumber, chargeId: row.chargeId, label: row.charge.label,
          amountPaise: input.amountPaise, returnMethod: input.method, returnReference: input.reference });
        balanceAfter += input.amountPaise;
      }
    } else if (input.kind === 'BACKDATE') {
      if (input.businessOn >= today) throw new BadRequestException('Choose a business date before today.');
      newPayment = { amountPaise: input.amountPaise, method: input.method, reference: input.reference,
        businessOn: input.businessOn, actorId: owner.id, actorUsername: owner.username,
        allocations: allocate(input.amountPaise, charges) };
      balanceAfter -= input.amountPaise;
    } else {
      const purchase = await tx.membershipPurchase.findFirst({ where: {
        id: input.purchaseId, memberId, startsOn: { gt: date(today) }, cancellation: null,
      }, include: { charge: { include: { allocations: { include: { payment: { select: { method: true } },
        reversals: { select: { amountPaise: true } } }, orderBy: { receiptNumber: 'asc' } } } } } });
      if (!purchase?.charge) throw new ConflictException('Only a queued membership can be canceled here.');
      const charge = purchase.charge;
      cancellation = { id: purchase.id, planName: purchase.planName, startsOn: day(purchase.startsOn),
        expiresOn: day(purchase.expiresOn), chargePaise: charge.amountPaise };
      let applied = 0;
      for (const row of charge.allocations) {
        const amountPaise = outstandingAllocation(row);
        if (!amountPaise) continue;
        applied += amountPaise;
        reversals.push({ receiptNumber: row.receiptNumber, chargeId: charge.id, label: charge.label,
          amountPaise, returnMethod: row.payment.method, returnReference: input.reference });
      }
      balanceAfter -= charge.amountPaise - applied;
    }
    const review = { kind: input.kind, reason: input.reason, today, owner: owner.username,
      original, cancellation, newPayment, reversals, balanceBefore, balanceAfter,
      refundPaise: reversals.reduce((sum, row) => sum + (row.returnMethod ? row.amountPaise : 0), 0) };
    const token = hash({ memberId, ownerId: owner.id, input, review,
      charges: charges.map((row) => [row.id, row.balancePaise]) });
    return { review, token };
  }

  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async preview(@Req() request: Request, @Param('number') number: string, @Body() body: Record<string, unknown>) {
    const owner = await this.auth.requireOwner(request);
    const input = readAdjustment(body);
    return this.auth.db.$transaction(async (tx) => {
      const member = await getMember(tx, memberNumber(number));
      return this.prepare(tx, member.id, owner, input);
    }, { isolationLevel: 'RepeatableRead' });
  }

  @Post('confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async confirm(@Req() request: Request, @Param('number') number: string, @Body() body: Record<string, unknown>) {
    const owner = await this.auth.requireOwner(request);
    const input = readAdjustment(body);
    const { key, token, password, confirmedReturn } = body;
    if (!validKey(key) || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw new BadRequestException('Invalid confirmation.');
    }
    if (typeof password !== 'string' || password.length > 128 || !await matchesPassword(password, owner.passwordHash)) {
      throw new UnauthorizedException('Owner password is incorrect.');
    }
    const numberValue = memberNumber(number);
    const requestHash = hash({ numberValue, input, token, confirmedReturn: confirmedReturn === true });
    return this.auth.db.$transaction(async (tx) => {
      await lockOperation(tx, owner.id, key);
      const previous = await tx.billingOperation.findUnique({ where: { actorId_key: { actorId: owner.id, key } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException('This retry key belongs to a different request.');
        return previous.result;
      }
      const member = await getMember(tx, numberValue);
      await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${member.id} FOR UPDATE`;
      let prepared;
      try { prepared = await this.prepare(tx, member.id, owner, input); }
      catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) {
          throw new ConflictException('The ledger changed. Review the adjustment again.');
        }
        throw error;
      }
      if (prepared.token !== token) throw new ConflictException('The ledger changed. Review the adjustment again.');
      const { review } = prepared;
      if (review.refundPaise && confirmedReturn !== true) {
        throw new BadRequestException('Confirm that the money shown in the preview has already been returned.');
      }
      let receipt = null;
      let postedNumber: number | undefined;
      if (review.newPayment) {
        const { businessOn, allocations, ...payment } = review.newPayment;
        const saved = await tx.payment.create({ data: { ...payment, memberId: member.id,
          memberName: member.fullName, memberNumber: member.memberNumber, balancePaise: BigInt(review.balanceAfter),
          businessDate: date(businessOn), allocations: { create: allocations.map(({ chargeId, amountPaise }) => ({ chargeId, amountPaise })) },
        }, select: { receiptNumber: true } });
        postedNumber = saved.receiptNumber;
      }
      await tx.ownerAdjustment.create({ data: { memberId: member.id, ownerId: owner.id,
        reason: input.reason, kind: input.kind, businessDate: date(review.today),
        originalReceiptNumber: input.kind === 'CORRECTION' ? input.receiptNumber : undefined,
        replacementReceiptNumber: input.kind === 'CORRECTION' ? postedNumber : undefined,
        backdatedReceiptNumber: input.kind === 'BACKDATE' ? postedNumber : undefined,
        canceledPurchaseId: review.cancellation?.id,
        reversals: { create: review.reversals.map(({ label: _label, ...row }) => row) },
      } });
      if (postedNumber) receipt = receiptView(await tx.payment.findUniqueOrThrow({
        where: { receiptNumber: postedNumber }, include: receiptInclude,
      }));
      const result = { receipt, purchase: null, balancePaise: review.balanceAfter,
        adjustmentKind: input.kind, refundPaise: review.refundPaise };
      await tx.billingOperation.create({ data: { actorId: owner.id, key, requestHash, result } });
      return result;
    }, { timeout: 15_000 });
  }
}
