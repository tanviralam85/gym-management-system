import { randomBytes } from 'node:crypto';
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header,
  HttpCode, Post, Req, Res, UnauthorizedException, UseGuards,
  type CanActivate, type ExecutionContext,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, publicAccount } from './auth.service.js';
import { hashPassword, normalizeUsername, validNewPassword, validUsername } from './credentials.js';

export class SameOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'GET') return true;
    const allowedOrigin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
    if (request.headers.origin !== allowedOrigin || !request.is('application/json')) {
      throw new ForbiddenException();
    }
    return true;
  }
}

@Controller('auth')
@UseGuards(SameOriginGuard, ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const username = normalizeUsername(body?.username);
    if (!validUsername(username) || typeof body?.password !== 'string' || body.password.length > 128) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    return this.auth.login(username, body.password, response);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() request: Request) {
    return publicAccount(await this.auth.requireAccount(request));
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.auth.logout(request, response);
  }

  @Post('change-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  changePassword(@Body() body: Record<string, unknown>, @Req() request: Request,
    @Res({ passthrough: true }) response: Response) {
    const { currentPassword, newPassword } = body ?? {};
    if (typeof currentPassword !== 'string' || currentPassword.length > 128 ||
        !validNewPassword(newPassword) || newPassword === currentPassword) {
      throw new BadRequestException('Choose a different password with 12–128 characters.');
    }
    return this.auth.changePassword(request, response, currentPassword, newPassword);
  }
}

@Controller('users')
@UseGuards(SameOriginGuard, ThrottlerGuard)
export class AccountsController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request) {
    await this.auth.requireOwner(request);
    const accounts = await this.auth.db.account.findMany({ orderBy: { username: 'asc' } });
    return accounts.map(publicAccount);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async provision(@Req() request: Request, @Body() body: Record<string, unknown>) {
    await this.auth.requireOwner(request);
    const username = normalizeUsername(body?.username);
    const role = body?.role;
    if (!validUsername(username) || (role !== 'STAFF' && role !== 'TRAINER')) {
      throw new BadRequestException('Enter a valid username and select Staff or Trainer.');
    }
    const temporaryPassword = randomBytes(18).toString('base64url');
    try {
      const account = await this.auth.db.account.create({ data: {
        username, role, passwordHash: await hashPassword(temporaryPassword),
      } });
      return { ...publicAccount(account), temporaryPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That username is already in use.');
      }
      throw error;
    }
  }
}
