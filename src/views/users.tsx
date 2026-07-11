import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatEpochSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicUserRow, UserRole } from "@/services/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

interface UsersViewProps {
  onAccountChanged: () => void;
}

interface UsersResponse {
  users: PublicUserRow[];
}

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  operator: "Vận hành",
  viewer: "Chỉ xem"
};

const fieldClassName = cn(
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow]",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
);

function isUsersResponse(value: unknown): value is UsersResponse {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as Partial<UsersResponse>).users)
  );
}

async function apiErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    code?: unknown;
  };
  switch (body.code) {
    case "duplicate_username":
      return "Tên đăng nhập đã tồn tại.";
    case "weak_password":
      return "Mật khẩu không được để trống.";
    case "last_admin":
      return "Không thể vô hiệu hóa hoặc hạ quyền admin cuối cùng.";
    default:
      return response.status === 403
        ? "Bạn không có quyền quản lý user."
        : "Không thể cập nhật user, vui lòng thử lại.";
  }
}

export function UsersView({ onAccountChanged }: UsersViewProps) {
  const [users, setUsers] = useState<PublicUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("operator");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>(
    {}
  );

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/users", { signal });
      if (!response.ok)
        throw new Error(`Users request failed (${response.status})`);
      const data: unknown = await response.json();
      if (!isUsersResponse(data)) throw new Error("Invalid users response");
      setUsers(data.users);
    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to load users:", error);
      setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadUsers(controller.signal);
    return () => controller.abort();
  }, [loadUsers]);

  const createNewUser = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCreating(true);
      setActionError(null);
      try {
        const response = await fetch("/api/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username,
            password,
            role,
            display_name: displayName || undefined
          })
        });
        if (!response.ok) {
          setActionError(await apiErrorMessage(response));
          return;
        }

        setUsername("");
        setDisplayName("");
        setPassword("");
        setRole("operator");
        await loadUsers();
        onAccountChanged();
      } catch (error) {
        console.error("Failed to create user:", error);
        setActionError("Không thể tạo user, vui lòng thử lại.");
      } finally {
        setCreating(false);
      }
    },
    [displayName, loadUsers, onAccountChanged, password, role, username]
  );

  const patchUser = useCallback(
    async (id: string, patch: Record<string, unknown>): Promise<boolean> => {
      setBusyUserId(id);
      setActionError(null);
      try {
        const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch)
        });
        if (!response.ok) {
          setActionError(await apiErrorMessage(response));
          return false;
        }

        onAccountChanged();
        await loadUsers();
        return true;
      } catch (error) {
        console.error("Failed to update user:", error);
        setActionError("Không thể cập nhật user, vui lòng thử lại.");
        return false;
      } finally {
        setBusyUserId(null);
      }
    },
    [loadUsers, onAccountChanged]
  );

  const resetPassword = useCallback(
    async (id: string) => {
      const nextPassword = passwordDrafts[id] ?? "";
      if (!nextPassword.trim()) {
        setActionError("Mật khẩu không được để trống.");
        return;
      }
      if (await patchUser(id, { password: nextPassword })) {
        setPasswordDrafts((current) => ({ ...current, [id]: "" }));
      }
    },
    [passwordDrafts, patchUser]
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-7xl gap-5 p-4 sm:p-6">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Tạo user</CardTitle>
            <CardDescription>
              Thêm tài khoản mới và phân quyền truy cập PayPilot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 xl:items-end"
              onSubmit={createNewUser}
            >
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="new-username">
                  Tên đăng nhập
                </label>
                <input
                  id="new-username"
                  aria-label="Tên đăng nhập"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  maxLength={64}
                  required
                  autoComplete="off"
                  className={fieldClassName}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="new-display-name"
                >
                  Tên hiển thị
                </label>
                <input
                  id="new-display-name"
                  aria-label="Tên hiển thị"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={64}
                  className={fieldClassName}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="new-password">
                  Mật khẩu
                </label>
                <input
                  id="new-password"
                  type="password"
                  aria-label="Mật khẩu"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  maxLength={200}
                  required
                  autoComplete="new-password"
                  className={fieldClassName}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="new-role">
                  Vai trò
                </label>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as UserRole)}
                >
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={creating}>
                {creating ? "Đang tạo…" : "Tạo user"}
              </Button>
            </form>
            {actionError && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {actionError}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden py-0 shadow-card">
          <CardHeader className="border-b py-5">
            <CardTitle>Danh sách user</CardTitle>
            <CardDescription>
              Thay đổi vai trò, trạng thái hoặc đặt lại mật khẩu.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-72 items-center justify-center p-6">
                <output className="text-sm text-muted-foreground">
                  Đang tải danh sách user…
                </output>
              </div>
            ) : loadError ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-6">
                <p className="text-sm text-destructive" role="alert">
                  Không thể tải danh sách user.
                </p>
                <Button variant="outline" size="sm" onClick={() => loadUsers()}>
                  Thử lại
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] border-collapse text-sm">
                  <caption className="sr-only">Danh sách user PayPilot</caption>
                  <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium" scope="col">
                        User
                      </th>
                      <th className="px-4 py-3 font-medium" scope="col">
                        Vai trò
                      </th>
                      <th className="px-4 py-3 font-medium" scope="col">
                        Trạng thái
                      </th>
                      <th className="px-4 py-3 font-medium" scope="col">
                        Ngày tạo
                      </th>
                      <th className="px-4 py-3 font-medium" scope="col">
                        Đặt lại mật khẩu
                      </th>
                      <th className="px-4 py-3 font-medium" scope="col">
                        Thao tác
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((user) => {
                      const busy = busyUserId === user.id;
                      return (
                        <tr key={user.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <p className="font-medium">{user.username}</p>
                            <p className="text-xs text-muted-foreground">
                              {user.display_name || "—"}
                            </p>
                          </td>
                          <td
                            className="px-4 py-3"
                            aria-label={`Vai trò của ${user.username}`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {roleLabels[user.role]}
                              </Badge>
                              <label
                                className="sr-only"
                                htmlFor={`role-${user.id}`}
                              >
                                Đổi vai trò {user.username}
                              </label>
                              <Select
                                value={user.role}
                                disabled={busy}
                                onValueChange={(value) =>
                                  patchUser(user.id, { role: value })
                                }
                              >
                                <SelectTrigger
                                  id={`role-${user.id}`}
                                  className="w-36"
                                  aria-label={`Đổi vai trò ${user.username}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(roleLabels).map(
                                    ([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    )
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                user.disabled === 0
                                  ? "secondary"
                                  : "destructive"
                              }
                            >
                              {user.disabled === 0 ? "Hoạt động" : "Đã khóa"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatEpochSeconds(user.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={passwordDrafts[user.id] ?? ""}
                                onChange={(event) =>
                                  setPasswordDrafts((current) => ({
                                    ...current,
                                    [user.id]: event.target.value
                                  }))
                                }
                                maxLength={200}
                                placeholder="Mật khẩu mới"
                                aria-label={`Mật khẩu mới cho ${user.username}`}
                                className={cn(fieldClassName, "w-40")}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => resetPassword(user.id)}
                              >
                                Đặt lại
                              </Button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              type="button"
                              variant={
                                user.disabled === 0 ? "destructive" : "outline"
                              }
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                patchUser(user.id, {
                                  disabled: user.disabled === 0
                                })
                              }
                            >
                              {user.disabled === 0
                                ? "Vô hiệu hóa"
                                : "Kích hoạt"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
