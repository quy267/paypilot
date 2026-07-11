import type { UserRole } from "../services/users";
import { constantTimeEqual } from "./crypto-compare";
import { hmacHex } from "./hmac";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionIdentity {
  userId: string;
  role: UserRole;
}

const USER_ROLES: ReadonlySet<string> = new Set<UserRole>([
  "admin",
  "operator",
  "viewer"
]);

function isUserRole(value: string): value is UserRole {
  return USER_ROLES.has(value);
}

export async function signSession(
  secret: string,
  identity: SessionIdentity,
  nowSeconds: number
): Promise<string> {
  const exp = nowSeconds + SESSION_MAX_AGE_SECONDS;
  // User IDs are usr_<UUID> (hex and hyphens), roles are fixed tokens, and exp
  // is decimal digits. None can contain ".", so the separator is unambiguous.
  const payload = `${identity.userId}.${identity.role}.${exp}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifySession(
  secret: string,
  token: string,
  nowSeconds: number
): Promise<SessionIdentity | null> {
  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [userId, role, expString, tokenHmac] = parts;
  if (!isUserRole(role) || !/^[1-9]\d*$/.test(expString)) return null;

  const exp = Number(expString);
  if (!Number.isSafeInteger(exp) || exp <= nowSeconds) return null;

  const payload = `${userId}.${role}.${expString}`;
  const expectedHmac = await hmacHex(secret, payload);
  if (!constantTimeEqual(expectedHmac, tokenHmac)) return null;

  return { userId, role };
}
