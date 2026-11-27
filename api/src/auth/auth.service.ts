import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import type { Account } from '@prisma/client';
import type { Request, Response } from 'express';
import { hashPassword, matchesPassword } from './credentials.js';
import { connectDatabase } from './database.js';

const idleMs = 30 * 60 * 1000;
const absoluteMs = 8 * 60 * 60 * 1000;
const cookieName = 'lion_gym_session';
const cookie = { httpOnly: true, sameSite: 'lax', path: '/api/v1',
  secure: process.env.NODE_ENV === 'production' } as const;

function digest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function publicAccount(account: Account) {
  return { id: account.id, username: account.username, role: account.role,
    mustChangePassword: account.mustChangePassword };
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  readonly db = connectDatabase();

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async login(username: string, password: string, response: Response) {
    const account = await this.db.account.findUnique({ where: { username } });
    if (!await matchesPassword(password, account?.passwordHash) || !account || account.disabledAt) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    const token = randomBytes(32).toString('base64url');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id} FOR UPDATE`;
      const current = await tx.account.findUnique({ where: { id: account.id } });
      if (!current || current.disabledAt || current.passwordHash !== account.passwordHash) {
        throw new UnauthorizedException('Invalid username or password.');
      }
      await tx.session.deleteMany({ where: { accountId: account.id, expiresAt: { lte: new Date() } } });
      await tx.session.create({ data: {
        tokenHash: digest(token), accountId: account.id, expiresAt: new Date(Date.now() + absoluteMs),
      } });
    });
    response.cookie(cookieName, token, { ...cookie, maxAge: absoluteMs });
    return publicAccount(account);
  }

  private tokenHash(request: Request) {
    const prefix = cookieName + '=';
    const token = request.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(prefix))?.slice(prefix.length);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? digest(token) : undefined;
  }

  async requireAccount(request: Request) {
    const tokenHash = this.tokenHash(request);
    if (!tokenHash) throw new UnauthorizedException();
    const now = new Date();
    const session = await this.db.session.findUnique({ where: { tokenHash }, include: { account: true } });
    if (!session || session.account.disabledAt || session.expiresAt <= now ||
        now.getTime() - session.lastSeenAt.getTime() >= idleMs) {
      throw new UnauthorizedException();
    }
    const touched = await this.db.session.updateMany({ where: { tokenHash }, data: { lastSeenAt: now } });
    if (!touched.count) throw new UnauthorizedException();
    return session.account;
  }

  async requireOwner(request: Request) {
    const account = await this.requireAccount(request);
    if (account.mustChangePassword || account.role !== 'OWNER') throw new ForbiddenException();
    return account;
  }

  async requireFrontDesk(request: Request) {
    const account = await this.requireAccount(request);
    if (account.mustChangePassword || account.role === 'TRAINER') throw new ForbiddenException();
    return account;
  }

  async logout(request: Request, response: Response) {
    const tokenHash = this.tokenHash(request);
    if (tokenHash) await this.db.session.deleteMany({ where: { tokenHash } });
    response.clearCookie(cookieName, cookie);
  }

  async changePassword(request: Request, response: Response, current: string, replacement: string) {
    const account = await this.requireAccount(request);
    if (!await matchesPassword(current, account.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    const passwordHash = await hashPassword(replacement);
    await this.db.$transaction(async (tx) => {
      const updated = await tx.account.updateMany({
        where: { id: account.id, passwordHash: account.passwordHash, disabledAt: null },
        data: { passwordHash, mustChangePassword: false },
      });
      if (!updated.count) throw new UnauthorizedException();
      await tx.session.deleteMany({ where: { accountId: account.id } });
    });
    response.clearCookie(cookieName, cookie);
  }
}
