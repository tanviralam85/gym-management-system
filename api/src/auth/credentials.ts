import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

export function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validUsername(value: string) {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
}

export function validNewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return salt + ':' + key.toString('hex');
}

export async function matchesPassword(password: string, encoded?: string) {
  const [salt, hash] = encoded?.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
  const candidate = await derive(password, salt, 64) as Buffer;
  return Boolean(encoded) && timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
