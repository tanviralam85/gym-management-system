import { BadRequestException, Body, ConflictException, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { SameOriginGuard } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';

const directoryFields = { memberNumber: true, fullName: true, phone: true } as const;
const pageSize = 20;

function text(value: unknown, label: string, max: number) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new BadRequestException(label + ' is invalid.');
  }
  return value.trim() || undefined;
}

function phoneDigits(value: string) {
  return value.replace(/[\s()-]/g, '').replace(/^(?:\+91|0091|91)(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
}

@Controller('members')
@UseGuards(SameOriginGuard)
export class MembersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request, @Query('q') query: unknown, @Query('page') page: unknown) {
    await this.auth.requireFrontDesk(request);
    const q = text(query, 'Search', 120);
    const currentPage = page === undefined ? 1 : Number(page);
    if (!Number.isSafeInteger(currentPage) || currentPage < 1 || currentPage > 10_000) {
      throw new BadRequestException('Invalid page.');
    }
    const numericId = q?.match(/^(?:LG-)?(\d+)$/i)?.[1];
    const memberNumber = Number(numericId);
    const digits = q ? phoneDigits(q) : '';
    let where: Prisma.MemberWhereInput | undefined;
    if (q) {
      const literal = q.replace(/[\\%_]/g, '\\$&');
      const alternatives: Prisma.MemberWhereInput[] = [{ fullName: { contains: literal, mode: 'insensitive' } }];
      if (/^\d+$/.test(digits)) alternatives.push({ phone: { contains: digits } });
      if (memberNumber > 0 && memberNumber <= 2_147_483_647) alternatives.push({ memberNumber });
      where = { OR: alternatives };
    }
    const rows = await this.auth.db.member.findMany({
      where, orderBy: [{ fullName: 'asc' }, { memberNumber: 'asc' }],
      skip: (currentPage - 1) * pageSize, take: pageSize + 1, select: directoryFields,
    });
    return { members: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async register(@Req() request: Request, @Body() body: Record<string, unknown>) {
    await this.auth.requireFrontDesk(request);
    const fullName = text(body?.fullName, 'Full name', 120);
    const digits = phoneDigits(text(body?.phone, 'Mobile number', 32) ?? '');
    if (!fullName || !/^[6-9]\d{9}$/.test(digits)) {
      throw new BadRequestException('Enter a full name and a valid Indian mobile number.');
    }
    const phone = '+91' + digits;
    const birth = text(body.dateOfBirth, 'Date of birth', 10);
    const dateOfBirth = birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) ? new Date(birth + 'T00:00:00Z') : undefined;
    if (birth && (!dateOfBirth || !Number.isFinite(dateOfBirth.getTime()) ||
        dateOfBirth.toISOString().slice(0, 10) !== birth || dateOfBirth > new Date())) {
      throw new BadRequestException('Enter a valid date of birth.');
    }
    const optional = {
      dateOfBirth, gender: text(body.gender, 'Gender', 50),
      address: text(body.address, 'Address', 250),
      emergencyContact: text(body.emergencyContact, 'Emergency contact', 100),
      guardianName: text(body.guardianName, 'Guardian name', 120),
      guardianContact: text(body.guardianContact, 'Guardian contact', 100),
    };
    return this.auth.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(240602, hashtext(${phone}))`;
      const existing = await tx.member.findMany({
        where: { phone }, select: directoryFields, orderBy: { memberNumber: 'asc' }, take: 20,
      });
      if (existing.length && body.confirmSharedPhone !== true) {
        throw new ConflictException({ code: 'SHARED_PHONE', message: 'This phone is already registered.', existing });
      }
      return tx.member.create({ data: { fullName, phone, ...optional }, select: directoryFields });
    });
  }
}
