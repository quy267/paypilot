import { constantTimeEqual } from "./crypto-compare";

export const PBKDF2_ITERATIONS = 100_000;
export const SALT_BYTES = 16;
export const KEY_BITS = 256;

const textEncoder = new TextEncoder();
const SALT_HEX_LENGTH = SALT_BYTES * 2;
const HASH_HEX_LENGTH = KEY_BITS / 4;
// Leave room for future upgrades without letting corrupted metadata exhaust Worker CPU.
const MAX_VERIFY_ITERATIONS = 1_000_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    key,
    KEY_BITS
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<{
  salt: string;
  hash: string;
  iterations: number;
}> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return {
    salt: bytesToHex(saltBytes),
    hash: await derivePasswordHash(password, saltBytes, PBKDF2_ITERATIONS),
    iterations: PBKDF2_ITERATIONS
  };
}

export async function verifyPassword(
  password: string,
  salt: string,
  hash: string,
  iterations: number
): Promise<boolean> {
  if (
    !Number.isSafeInteger(iterations) ||
    iterations <= 0 ||
    iterations > MAX_VERIFY_ITERATIONS ||
    salt.length !== SALT_HEX_LENGTH ||
    hash.length !== HASH_HEX_LENGTH ||
    !/^[0-9a-f]+$/i.test(salt) ||
    !/^[0-9a-f]+$/i.test(hash)
  ) {
    return false;
  }

  const derivedHash = await derivePasswordHash(
    password,
    hexToBytes(salt),
    iterations
  );
  return constantTimeEqual(derivedHash, hash.toLowerCase());
}
