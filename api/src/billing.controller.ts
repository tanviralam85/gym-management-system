import { createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, Header, HttpCode,
  NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from './auth/auth.service.js';
import { SameOriginGuard } from './auth/auth.controller.js';

const dayMs = 86_400_000;
const businessCalendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata',
  year: 'numeric', month: '2-digit', day: '2-digit' });

export function businessDate() {
  const parts = businessCalendar.formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

export function date(value: string) {
  return new Date(value + 'T00:00:00.000Z');
}

export function day(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date(value).getTime()) && day(date(value)) === value;
}

export function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validKey(key: unknown): key is string {
  return typeof key === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(key);
}

export async function lockOperation(tx: Prisma.TransactionClient, actorId: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(240603, hashtext(${actorId + ':' + key}))`;
}

function readInput(body: Record<string, unknown>) {
  const { planId, amountPaise, method, dueDate, reference } = body ?? {};
  if ((planId !== null && (typeof planId !== 'string' || !/^[\w-]{1,64}$/.test(planId))) ||
      typeof amountPaise !== 'number' || !Number.isInteger(amountPaise) || amountPaise < 0 ||
      amountPaise > 2_147_483_647 || (!planId && amountPaise === 0) ||
      (method !== 'CASH' && method !== 'UPI') ||
      (dueDate !== null && (typeof dueDate !== 'string' || !validDate(dueDate))) ||
      (reference !== null && (typeof reference !== 'string' || reference.length > 100))) {
    throw new BadRequestException('Enter a valid plan, payment amount, method and due date.');
  }
  return { planId, amountPaise, method, dueDate, reference: reference?.trim() || null } as const;
}

export function memberNumber(value: string) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < 1 || number > 2_147_483_647) throw new NotFoundException();
  return number;
}

export async function getMember(tx: Prisma.TransactionClient, number: number) {
  const member = await tx.member.findUnique({ where: { memberNumber: number } });
  if (!member) throw new NotFoundException('Member not found.');
  return member;
}

export async function openCharges(tx: Prisma.TransactionClient, memberId: string, restored = new Map<number, number>()) {
  const charges = await tx.memberCharge.findMany({
    where: { memberId, OR: [{ purchaseId: null }, { purchase: { cancellation: null } }] },
    orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
    select: { id: true, label: true, amountPaise: true, dueDate: true,
      allocations: { select: { amountPaise: true, reversals: { select: { amountPaise: true } } } } },
  });
  return charges.map(({ allocations, ...charge }) => ({
    ...charge, balancePaise: charge.amountPaise + (restored.get(charge.id) ?? 0) -
      allocations.reduce((sum, row) => sum + outstandingAllocation(row), 0),
  })).filter((charge) => charge.balancePaise > 0);
}

export function outstandingAllocation(row: { amountPaise: number; reversals: { amountPaise: number }[] }) {
  return row.amountPaise - row.reversals.reduce((sum, reversal) => sum + reversal.amountPaise, 0);
}

function term(today: string, unit: 'MONTHS' | 'DAYS', duration: number,
  previous?: { expiresOn: Date; anchorDay: number; durationUnit: 'MONTHS' | 'DAYS' }) {
  const start = previous ? new Date(previous.expiresOn.getTime() + dayMs) : date(today);
  const base = previous?.expiresOn ?? start;
  const anchorDay = previous?.durationUnit === 'MONTHS' ? previous.anchorDay : base.getUTCDate();
  let expiry: Date;
  if (unit === 'DAYS') {
    expiry = new Date(start.getTime() + (duration - 1) * dayMs);
  } else {
    const endOfMonth = new Date(base);
    endOfMonth.setUTCMonth(base.getUTCMonth() + duration + 1, 0);
    expiry = new Date(endOfMonth);
    expiry.setUTCDate(Math.min(anchorDay, endOfMonth.getUTCDate()));
  }
  if (!Number.isFinite(expiry.getTime()) || expiry.getUTCFullYear() > 9999 || expiry < start) {
    throw new BadRequestException('The plan duration produces an invalid expiry date.');
  }
  return { startsOn: day(start), expiresOn: day(expiry), anchorDay };
}

export const receiptInclude = {
  supersededBy: { select: { replacementReceiptNumber: true } },
  replacementFor: { select: { originalReceiptNumber: true } },
  allocations: { include: { charge: { select: { label: true } },
    reversals: { include: { adjustment: { select: { kind: true, businessDate: true } } }, orderBy: { adjustmentId: 'asc' } },
  }, orderBy: { chargeId: 'asc' } },
} as const;

export function receiptView(payment: Prisma.PaymentGetPayload<{ include: typeof receiptInclude }>) {
  return { receiptNumber: payment.receiptNumber, memberNumber: payment.memberNumber,
    memberName: payment.memberName, actor: payment.actorUsername, amountPaise: payment.amountPaise,
    method: payment.method, reference: payment.reference, balancePaise: Number(payment.balancePaise),
    businessDate: day(payment.businessDate), recordedAt: payment.createdAt.toISOString(),
    supersededBy: payment.supersededBy?.replacementReceiptNumber ?? null,
    replaces: payment.replacementFor?.originalReceiptNumber ?? null,
    allocations: payment.allocations.map(({ amountPaise, charge }) => ({ label: charge.label, amountPaise })),
    refunds: payment.allocations.flatMap(({ charge, reversals }) => reversals
      .filter((reversal) => reversal.returnMethod !== null)
      .map((reversal) => ({ label: charge.label, amountPaise: reversal.amountPaise, method: reversal.returnMethod,
        reference: reversal.returnReference, businessDate: day(reversal.adjustment.businessDate),
        kind: reversal.adjustment.kind }))),
  };
}

@Controller('billing')
@UseGuards(SameOriginGuard)
export class BillingController {
  constructor(private readonly auth: AuthService) {}

  @Get('members/:number')
  @Header('Cache-Control', 'no-store')
  async summary(@Req() request: Request, @Param('number') number: string) {
    await this.auth.requireFrontDesk(request);
    return this.auth.db.$transaction(async (tx) => {
      const member = await getMember(tx, memberNumber(number));
      const today = businessDate();
      const purchases = await tx.membershipPurchase.findMany({
        where: { memberId: member.id, expiresOn: { gte: date(today) }, cancellation: null },
        orderBy: { startsOn: 'asc' }, select: { id: true, planName: true, startsOn: true, expiresOn: true },
      });
      const charges = await openCharges(tx, member.id);
      const receipts = await tx.payment.findMany({ where: { memberId: member.id }, take: 20,
        orderBy: { receiptNumber: 'desc' }, select: { receiptNumber: true, amountPaise: true,
          method: true, businessDate: true, supersededBy: { select: { replacementReceiptNumber: true } } } });
      const plans = await tx.membershipPlan.findMany({ where: { active: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, pricePaise: true } });
      return { today, balancePaise: charges.reduce((sum, charge) => sum + charge.balancePaise, 0),
        charges, plans, purchases: purchases.map((purchase) => ({
          ...purchase, startsOn: day(purchase.startsOn), expiresOn: day(purchase.expiresOn),
        })), receipts: receipts.map((receipt) => ({ ...receipt, businessDate: day(receipt.businessDate),
          supersededBy: receipt.supersededBy?.replacementReceiptNumber ?? null })) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  private async calculate(tx: Prisma.TransactionClient, number: number,
    input: ReturnType<typeof readInput>, actor: { id: string; username: string }) {
    const member = await getMember(tx, number);
    const today = businessDate();
    const charges = await openCharges(tx, member.id);
    const priorPaise = charges.reduce((sum, charge) => sum + charge.balancePaise, 0);
    let purchase = null;
    if (input.planId) {
      const plan = await tx.membershipPlan.findUnique({ where: { id: input.planId } });
      if (!plan?.active) throw new ConflictException('This plan is no longer available.');
      const previous = await tx.membershipPurchase.findFirst({
        where: { memberId: member.id, expiresOn: { gte: date(today) }, cancellation: null },
        orderBy: { expiresOn: 'desc' },
      });
      if (previous && day(previous.startsOn) > today) {
        throw new ConflictException('This member already has a queued renewal.');
      }
      purchase = { planId: plan.id, planName: plan.name, pricePaise: plan.pricePaise,
        duration: plan.duration, durationUnit: plan.durationUnit,
        ...term(today, plan.durationUnit, plan.duration, previous ?? undefined) };
    }
    const totalPaise = priorPaise + (purchase?.pricePaise ?? 0);
    if (input.amountPaise > totalPaise) {
      throw new BadRequestException('Payment cannot exceed the total outstanding balance.');
    }
    const appliedToPurchase = Math.max(0, input.amountPaise - priorPaise);
    const unpaidPurchase = (purchase?.pricePaise ?? 0) > appliedToPurchase;
    if (unpaidPurchase && (!input.dueDate || input.dueDate < today)) {
      throw new BadRequestException('Choose a due date on or after today for the unpaid purchase.');
    }
    let remaining = input.amountPaise;
    const allocations: { chargeId: number | null; label: string; amountPaise: number }[] = [];
    for (const charge of charges) {
      if (remaining === 0) break;
      const amountPaise = Math.min(remaining, charge.balancePaise);
      allocations.push({ chargeId: charge.id, label: charge.label, amountPaise });
      remaining -= amountPaise;
    }
    if (remaining && purchase) {
      allocations.push({ chargeId: null, label: purchase.planName, amountPaise: remaining });
    }
    const review = { memberNumber: member.memberNumber, memberName: member.fullName, actor: actor.username,
      today, dueDate: unpaidPurchase ? input.dueDate : null, priorPaise, purchase, allocations,
      balancePaise: totalPaise - input.amountPaise, amountPaise: input.amountPaise, method: input.method,
      reference: input.reference };
    const token = hash({ actorId: actor.id, input, review, charges: charges.map((c) => [c.id, c.balancePaise]) });
    return { member, review, token };
  }

  @Post('members/:number/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async preview(@Req() request: Request, @Param('number') number: string, @Body() body: Record<string, unknown>) {
    const actor = await this.auth.requireFrontDesk(request);
    const input = readInput(body);
    const { review, token } = await this.auth.db.$transaction(
      (tx) => this.calculate(tx, memberNumber(number), input, actor), { isolationLevel: 'RepeatableRead' });
    return { ...review, token };
  }

  @Post('members/:number/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirm(@Req() request: Request, @Param('number') number: string, @Body() body: Record<string, unknown>) {
    const actor = await this.auth.requireFrontDesk(request);
    const input = readInput(body);
    const { key, token } = body;
    if (!validKey(key) || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw new BadRequestException('Invalid confirmation.');
    }
    const memberNo = memberNumber(number);
    const requestHash = hash({ memberNo, input, token });
    return this.auth.db.$transaction(async (tx) => {
      await lockOperation(tx, actor.id, key);
      const previous = await tx.billingOperation.findUnique({ where: { actorId_key: { actorId: actor.id, key } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException('This retry key belongs to a different request.');
        return previous.result;
      }
      const locked = await getMember(tx, memberNo);
      await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${locked.id} FOR UPDATE`;
      let calculated;
      try {
        calculated = await this.calculate(tx, memberNo, input, actor);
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) {
          throw new ConflictException('The purchase or balance changed. Review the details again.');
        }
        throw error;
      }
      if (calculated.token !== token) throw new ConflictException('The purchase or balance changed. Review the details again.');
      const { member, review } = calculated;
      const businessOn = date(review.today);
      let newChargeId: number | undefined;
      if (review.purchase) {
        const { startsOn, expiresOn, ...terms } = review.purchase;
        const purchase = await tx.membershipPurchase.create({ data: { ...terms, startsOn: date(startsOn),
          expiresOn: date(expiresOn), businessDate: businessOn, memberId: member.id, actorId: actor.id } });
        const charge = await tx.memberCharge.create({ data: { memberId: member.id, purchaseId: purchase.id,
          kind: 'MEMBERSHIP', label: terms.planName, amountPaise: terms.pricePaise, businessDate: businessOn,
          dueDate: review.dueDate ? date(review.dueDate) : null } });
        newChargeId = charge.id;
      }
      let receipt = null;
      if (input.amountPaise) {
        const payment = await tx.payment.create({ data: {
          memberId: member.id, memberName: member.fullName, memberNumber: member.memberNumber,
          actorId: actor.id, actorUsername: actor.username, amountPaise: input.amountPaise, method: input.method,
          reference: input.reference, businessDate: businessOn, balancePaise: BigInt(review.balancePaise),
          allocations: { create: review.allocations.map(({ chargeId, amountPaise }) => {
            const id = chargeId ?? newChargeId;
            if (id === undefined) throw new Error('Missing charge for payment allocation.');
            return { chargeId: id, amountPaise };
          }) },
        }, include: receiptInclude });
        receipt = receiptView(payment);
      }
      const result = { receipt, balancePaise: review.balancePaise, purchase: review.purchase };
      await tx.billingOperation.create({ data: { actorId: actor.id, key, requestHash, result } });
      return result;
    }, { timeout: 15_000 });
  }

  @Post('operations/:key/resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async resolve(@Req() request: Request, @Param('key') key: string) {
    const actor = await this.auth.requireFrontDesk(request);
    if (!validKey(key)) throw new BadRequestException('Invalid operation key.');
    return this.auth.db.$transaction(async (tx) => {
      await lockOperation(tx, actor.id, key);
      const previous = await tx.billingOperation.findUnique({ where: { actorId_key: { actorId: actor.id, key } } });
      if (previous) return previous.result;
      const result = { abandoned: true };
      await tx.billingOperation.create({ data: { actorId: actor.id, key, requestHash: 'abandoned', result } });
      return result;
    }, { timeout: 20_000 });
  }

  @Get('receipts/:number')
  @Header('Cache-Control', 'no-store')
  async receipt(@Req() request: Request, @Param('number') number: string) {
    await this.auth.requireFrontDesk(request);
    const receipt = await this.auth.db.payment.findUnique({
      where: { receiptNumber: memberNumber(number) }, include: receiptInclude,
    });
    if (!receipt) throw new NotFoundException('Receipt not found.');
    return receiptView(receipt);
  }
}
