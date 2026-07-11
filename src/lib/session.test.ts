import { describe, expect, it } from "vitest";
import { hmacHex } from "./hmac";
import { SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "./session";

const NOW_SECONDS = 1_800_000_000;
const SECRET = "session-signing-secret";
const IDENTITY = {
  userId: "usr_01234567-89ab-cdef-0123-456789abcdef",
  role: "operator" as const
};

describe("signed sessions", () => {
  it("round-trips the signed identity", async () => {
    const token = await signSession(SECRET, IDENTITY, NOW_SECONDS);

    await expect(verifySession(SECRET, token, NOW_SECONDS)).resolves.toEqual(
      IDENTITY
    );
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(SECRET, IDENTITY, NOW_SECONDS);
    const tampered = token.replace(IDENTITY.userId, `${IDENTITY.userId}0`);

    await expect(
      verifySession(SECRET, tampered, NOW_SECONDS)
    ).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession(SECRET, IDENTITY, NOW_SECONDS);

    await expect(
      verifySession(SECRET, token, NOW_SECONDS + SESSION_MAX_AGE_SECONDS)
    ).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(SECRET, IDENTITY, NOW_SECONDS);

    await expect(
      verifySession("wrong-secret", token, NOW_SECONDS)
    ).resolves.toBeNull();
  });

  it("rejects an invalid role even with a valid signature", async () => {
    const exp = NOW_SECONDS + SESSION_MAX_AGE_SECONDS;
    const payload = `${IDENTITY.userId}.auditor.${exp}`;
    const token = `${payload}.${await hmacHex(SECRET, payload)}`;

    await expect(verifySession(SECRET, token, NOW_SECONDS)).resolves.toBeNull();
  });

  it("rejects tokens that do not contain exactly four parts", async () => {
    await expect(
      verifySession(SECRET, "usr_example.operator.1800000001", NOW_SECONDS)
    ).resolves.toBeNull();
    await expect(
      verifySession(
        SECRET,
        "usr_example.operator.1800000001.signature.extra",
        NOW_SECONDS
      )
    ).resolves.toBeNull();
  });
});
