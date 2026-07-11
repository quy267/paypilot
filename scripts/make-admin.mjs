#!/usr/bin/env node

import { createInterface } from "node:readline/promises";

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const textEncoder = new TextEncoder();

function usage() {
  console.error("Usage: node scripts/make-admin.mjs <username> [display_name]");
}

async function readPassword() {
  if (process.env.PAYPILOT_ADMIN_PASSWORD !== undefined) {
    return process.env.PAYPILOT_ADMIN_PASSWORD;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stderr
  });
  try {
    return await readline.question("Password: ");
  } finally {
    readline.close();
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function shellString(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const [, , username, displayName] = process.argv;
if (!username) {
  usage();
  process.exitCode = 1;
} else {
  const password = await readPassword();
  if (!password.trim()) {
    console.error("Password must not be empty.");
    process.exitCode = 1;
  } else {
    const saltBytes = globalThis.crypto.getRandomValues(
      new Uint8Array(SALT_BYTES)
    );
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      textEncoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS
      },
      key,
      KEY_BITS
    );

    const id = `usr_${globalThis.crypto.randomUUID()}`;
    const salt = bytesToHex(saltBytes);
    const hash = bytesToHex(new Uint8Array(bits));
    const createdAt = Math.floor(Date.now() / 1000);
    const displayNameSql =
      displayName === undefined ? "NULL" : sqlString(displayName);
    const statement =
      "INSERT INTO users " +
      "(id, username, display_name, password_hash, password_salt, password_iterations, role, disabled, created_at) " +
      `VALUES (${sqlString(id)}, ${sqlString(username)}, ${displayNameSql}, ${sqlString(hash)}, ${sqlString(salt)}, ${PBKDF2_ITERATIONS}, 'admin', 0, ${createdAt});`;

    console.log(
      `npx wrangler d1 execute paypilot-db --remote --command ${shellString(statement)}`
    );
  }
}
