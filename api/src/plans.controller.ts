import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { SameOriginGuard } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';

function planInput(body: Record<string, unknown>): Prisma.MembershipPlanCreateInput {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const { duration, durationUnit, pricePaise, active } = body ?? {};
  if (!name || name.length > 100 || (durationUnit !== 'MONTHS' && durationUnit !== 'DAYS') ||
      typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 2_147_483_647 ||
      typeof pricePaise !== 'number' || !Number.isInteger(pricePaise) || pricePaise < 0 ||
      pricePaise > 2_147_483_647 || typeof active !== 'boolean') {
    throw new BadRequestException('Enter a plan name, positive whole duration, valid INR price and status.');
  }
  return { name, durationUnit, duration, pricePaise, active };
}

@Controller('plans')
@UseGuards(SameOriginGuard)
export class PlansController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request) {
    await this.auth.requireOwner(request);
    return this.auth.db.membershipPlan.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }, { id: 'asc' }] });
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    await this.auth.requireOwner(request);
    return this.auth.db.membershipPlan.create({ data: planInput(body) });
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    await this.auth.requireOwner(request);
    const [plan] = await this.auth.db.membershipPlan.updateManyAndReturn({ where: { id }, data: planInput(body) });
    if (!plan) throw new NotFoundException('Plan not found.');
    return plan;
  }
}
