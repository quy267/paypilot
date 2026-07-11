import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../lib/password";
import {
  DuplicateUsernameError,
  WeakPasswordError,
  countAdmins,
  createUser,
  getUserAuthByUsername,
  getUserById,
  listUsers,
  updateUser
} from "./users";

function asD1Database(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let bindings: SQLInputValue[] = [];
      const namedBindings = () =>
        Object.fromEntries(
          bindings.map((value, index) => [`?${index + 1}`, value])
        );
      const prepared = {
        bind(...values: unknown[]) {
          bindings = values as SQLInputValue[];
          return prepared;
        },
        async all<T>() {
          return { results: statement.all(namedBindings()) as T[] };
        },
        async first<T>() {
          return (statement.get(namedBindings()) as T | undefined) ?? null;
        },
        async run() {
          statement.run(namedBindings());
          return { success: true };
        }
      };
      return prepared as unknown as D1PreparedStatement;
    }
  } as unknown as D1Database;
}

describe("users service", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      readFileSync(new URL("../../schema.sql", import.meta.url), "utf8")
    );
    db = asD1Database(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates a user and retrieves its authentication fields", async () => {
    const created = await createUser(db, {
      username: "minh",
      password: "correct horse battery staple",
      role: "admin",
      display_name: "Minh Nguyen"
    });
    const auth = await getUserAuthByUsername(db, "minh");
    const publicUser = await getUserById(db, created.id);

    expect(created).toMatchObject({
      username: "minh",
      display_name: "Minh Nguyen",
      role: "admin",
      disabled: 0
    });
    expect(created).not.toHaveProperty("password_hash");
    expect(publicUser).toEqual(created);
    expect(publicUser).not.toHaveProperty("password_hash");
    expect(auth).toMatchObject({ id: created.id, username: "minh" });
    expect(auth?.password_hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      verifyPassword(
        "correct horse battery staple",
        auth?.password_salt ?? "",
        auth?.password_hash ?? "",
        auth?.password_iterations ?? 0
      )
    ).resolves.toBe(true);
    await expect(countAdmins(db)).resolves.toBe(1);
  });

  it("rejects duplicate usernames with a typed error", async () => {
    await createUser(db, {
      username: "duplicate",
      password: "first-password",
      role: "viewer"
    });

    await expect(
      createUser(db, {
        username: "duplicate",
        password: "second-password",
        role: "operator"
      })
    ).rejects.toBeInstanceOf(DuplicateUsernameError);
  });

  it("rejects empty passwords before create or reset", async () => {
    await expect(
      createUser(db, {
        username: "empty-password",
        password: "   ",
        role: "viewer"
      })
    ).rejects.toMatchObject({
      code: "WEAK_PASSWORD"
    } satisfies Partial<WeakPasswordError>);

    const user = await createUser(db, {
      username: "valid-password",
      password: "valid",
      role: "viewer"
    });
    await expect(
      updateUser(db, user.id, { password: "" })
    ).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it("lists only public fields in creation order", async () => {
    const first = await createUser(db, {
      username: "first",
      password: "first-password",
      role: "viewer"
    });
    const second = await createUser(db, {
      username: "second",
      password: "second-password",
      role: "operator"
    });
    sqlite
      .prepare("UPDATE users SET created_at = ? WHERE id = ?")
      .run(1, first.id);
    sqlite
      .prepare("UPDATE users SET created_at = ? WHERE id = ?")
      .run(2, second.id);

    const users = await listUsers(db);
    expect(users.map(({ username }) => username)).toEqual(["first", "second"]);
    expect(users[0]).not.toHaveProperty("password_hash");
    expect(users[0]).not.toHaveProperty("password_salt");
    expect(users[0]).not.toHaveProperty("password_iterations");
  });

  it("updates role, disabled state, and password", async () => {
    const created = await createUser(db, {
      username: "operator",
      password: "old-password",
      role: "operator"
    });

    const updated = await updateUser(db, created.id, {
      role: "admin",
      disabled: true,
      password: "new-password"
    });
    const auth = await getUserAuthByUsername(db, "operator");

    expect(updated).toMatchObject({ role: "admin", disabled: 1 });
    await expect(countAdmins(db)).resolves.toBe(0);
    await expect(
      verifyPassword(
        "old-password",
        auth?.password_salt ?? "",
        auth?.password_hash ?? "",
        auth?.password_iterations ?? 0
      )
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "new-password",
        auth?.password_salt ?? "",
        auth?.password_hash ?? "",
        auth?.password_iterations ?? 0
      )
    ).resolves.toBe(true);
  });
});
