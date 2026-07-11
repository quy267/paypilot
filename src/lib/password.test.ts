import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a password against its derived hash", async () => {
    const result = await hashPassword("correct horse battery staple");

    await expect(
      verifyPassword(
        "correct horse battery staple",
        result.salt,
        result.hash,
        result.iterations
      )
    ).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const result = await hashPassword("right-password");

    await expect(
      verifyPassword(
        "wrong-password",
        result.salt,
        result.hash,
        result.iterations
      )
    ).resolves.toBe(false);
  });

  it("uses a fresh salt for each hash", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password")
    ]);

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("rejects a tampered hash", async () => {
    const result = await hashPassword("untampered-password");
    const tamperedHash = `${result.hash[0] === "0" ? "1" : "0"}${result.hash.slice(1)}`;

    await expect(
      verifyPassword(
        "untampered-password",
        result.salt,
        tamperedHash,
        result.iterations
      )
    ).resolves.toBe(false);
  });

  it("rejects an excessive stored iteration count", async () => {
    const result = await hashPassword("bounded-password");

    await expect(
      verifyPassword("bounded-password", result.salt, result.hash, 1_000_001)
    ).resolves.toBe(false);
  });
});
