import { hashPassword } from "../lib/password";

export type UserRole = "admin" | "operator" | "viewer";

const WRITE_ROLES: ReadonlySet<UserRole> = new Set(["admin", "operator"]);

export function canWrite(role: UserRole): boolean {
  return WRITE_ROLES.has(role);
}

export interface PublicUserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  disabled: number;
  created_at: number;
}

export interface UserAuthRow extends PublicUserRow {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
  display_name?: string | null;
}

export interface UpdateUserInput {
  role?: UserRole;
  disabled?: boolean;
  password?: string;
}

export class DuplicateUsernameError extends Error {
  readonly code = "DUPLICATE_USERNAME";

  constructor(username: string, options?: ErrorOptions) {
    super(`Username already exists: ${username}`, options);
    this.name = "DuplicateUsernameError";
  }
}

export class WeakPasswordError extends Error {
  readonly code = "WEAK_PASSWORD";

  constructor(options?: ErrorOptions) {
    super("Password must not be empty", options);
    this.name = "WeakPasswordError";
  }
}

const PUBLIC_COLUMNS = "id, username, display_name, role, disabled, created_at";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isDuplicateUsernameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: users\.username/i.test(error.message)
  );
}

function assertNonEmptyPassword(password: string): void {
  if (!password.trim()) throw new WeakPasswordError();
}

export async function getUserAuthByUsername(
  db: D1Database,
  username: string
): Promise<UserAuthRow | null> {
  return db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}, password_hash, password_salt, password_iterations
       FROM users
       WHERE username = ?1`
    )
    .bind(username)
    .first<UserAuthRow>();
}

export async function getUserById(
  db: D1Database,
  id: string
): Promise<PublicUserRow | null> {
  return db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}
       FROM users
       WHERE id = ?1`
    )
    .bind(id)
    .first<PublicUserRow>();
}

export async function createUser(
  db: D1Database,
  input: CreateUserInput
): Promise<PublicUserRow> {
  assertNonEmptyPassword(input.password);
  const password = await hashPassword(input.password);
  const user: PublicUserRow = {
    id: `usr_${crypto.randomUUID()}`,
    username: input.username,
    display_name: input.display_name ?? null,
    role: input.role,
    disabled: 0,
    created_at: nowSeconds()
  };

  try {
    await db
      .prepare(
        `INSERT INTO users
           (id, username, display_name, password_hash, password_salt, password_iterations, role, disabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
      .bind(
        user.id,
        user.username,
        user.display_name,
        password.hash,
        password.salt,
        password.iterations,
        user.role,
        user.disabled,
        user.created_at
      )
      .run();
  } catch (error) {
    if (isDuplicateUsernameError(error)) {
      throw new DuplicateUsernameError(input.username, { cause: error });
    }
    throw error;
  }

  return user;
}

export async function listUsers(db: D1Database): Promise<PublicUserRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}
       FROM users
       ORDER BY created_at ASC, id ASC`
    )
    .all<PublicUserRow>();
  return results ?? [];
}

export async function updateUser(
  db: D1Database,
  id: string,
  input: UpdateUserInput
): Promise<PublicUserRow | null> {
  const assignments: string[] = [];
  const bindings: Array<string | number> = [];

  if (input.role !== undefined) {
    bindings.push(input.role);
    assignments.push(`role = ?${bindings.length}`);
  }
  if (input.disabled !== undefined) {
    bindings.push(input.disabled ? 1 : 0);
    assignments.push(`disabled = ?${bindings.length}`);
  }
  if (input.password !== undefined) {
    assertNonEmptyPassword(input.password);
    const password = await hashPassword(input.password);
    bindings.push(password.hash, password.salt, password.iterations);
    assignments.push(
      `password_hash = ?${bindings.length - 2}`,
      `password_salt = ?${bindings.length - 1}`,
      `password_iterations = ?${bindings.length}`
    );
  }

  if (assignments.length > 0) {
    bindings.push(id);
    await db
      .prepare(
        `UPDATE users
         SET ${assignments.join(", ")}
         WHERE id = ?${bindings.length}`
      )
      .bind(...bindings)
      .run();
  }

  return db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}
       FROM users
       WHERE id = ?1`
    )
    .bind(id)
    .first<PublicUserRow>();
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM users
       WHERE role = 'admin' AND disabled = 0`
    )
    .first<{ total: number }>();
  return row?.total ?? 0;
}
