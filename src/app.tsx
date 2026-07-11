import { Suspense, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoginScreen } from "@/components/login-screen";
import { useHashRoute } from "@/hooks/use-hash-route";
import { DashboardView } from "@/views/dashboard";
import { DecisionsView } from "@/views/decisions";
import { InboxView } from "@/views/inbox";
import { UsersView } from "@/views/users";
import type { UserRole } from "@/services/users";

interface CurrentUser {
  username: string;
  display_name: string | null;
  role: UserRole;
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<CurrentUser>;
  return (
    typeof user.username === "string" &&
    (user.display_name === null || typeof user.display_name === "string") &&
    (user.role === "admin" ||
      user.role === "operator" ||
      user.role === "viewer")
  );
}

interface AuthenticatedAppProps {
  currentUser: CurrentUser;
  onLogout: () => void;
  onAccountChanged: () => void;
}

function AuthenticatedApp({
  currentUser,
  onLogout,
  onAccountChanged
}: AuthenticatedAppProps) {
  const { route, navigate } = useHashRoute();

  useEffect(() => {
    if (route === "users" && currentUser.role !== "admin") {
      navigate("inbox");
    }
  }, [currentUser.role, navigate, route]);

  return (
    <AppShell
      route={route}
      username={currentUser.username}
      role={currentUser.role}
      onNavigate={navigate}
      onLogout={onLogout}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Đang tải…
          </div>
        }
      >
        <div className={route === "inbox" ? "h-full" : "hidden h-full"}>
          <InboxView canWrite={currentUser.role !== "viewer"} />
        </div>
        {route === "dashboard" && <DashboardView />}
        {route === "decisions" && <DecisionsView />}
        {route === "users" && currentUser.role === "admin" && (
          <UsersView onAccountChanged={onAccountChanged} />
        )}
      </Suspense>
    </AppShell>
  );
}

type AuthState = "checking" | "authed" | "guest";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const loadMe = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/me", { signal });
      if (response.status === 401) {
        setCurrentUser(null);
        setAuthState("guest");
        return;
      }
      if (!response.ok) {
        throw new Error(`Current-user request failed (${response.status})`);
      }

      const data: unknown = await response.json();
      if (!isCurrentUser(data))
        throw new Error("Invalid current-user response");
      setCurrentUser(data);
      setAuthState("authed");
    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to check auth:", error);
      setCurrentUser(null);
      setAuthState("guest");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadMe(controller.signal);
    return () => controller.abort();
  }, [loadMe]);

  const handleAuthed = useCallback(() => {
    setAuthState("checking");
    void loadMe();
  }, [loadMe]);

  const handleAccountChanged = useCallback(() => {
    void loadMe();
  }, [loadMe]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (e) {
      console.error("Failed to log out:", e);
    } finally {
      setCurrentUser(null);
      setAuthState("guest");
    }
  }, []);

  if (authState === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Đang tải…
      </div>
    );
  }

  if (authState === "guest") {
    return <LoginScreen onAuthed={handleAuthed} />;
  }

  if (!currentUser) return <LoginScreen onAuthed={handleAuthed} />;

  return (
    <AuthenticatedApp
      currentUser={currentUser}
      onLogout={handleLogout}
      onAccountChanged={handleAccountChanged}
    />
  );
}
