import { Suspense, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoginScreen } from "@/components/login-screen";
import { useHashRoute } from "@/hooks/use-hash-route";
import { DashboardView } from "@/views/dashboard";
import { DecisionsView } from "@/views/decisions";
import { InboxView } from "@/views/inbox";

interface AuthenticatedAppProps {
  onLogout: () => void;
}

function AuthenticatedApp({ onLogout }: AuthenticatedAppProps) {
  const { route, navigate } = useHashRoute();

  return (
    <AppShell route={route} onNavigate={navigate} onLogout={onLogout}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Đang tải…
          </div>
        }
      >
        <div className={route === "inbox" ? "h-full" : "hidden h-full"}>
          <InboxView />
        </div>
        {route === "dashboard" && <DashboardView />}
        {route === "decisions" && <DecisionsView />}
      </Suspense>
    </AppShell>
  );
}

type AuthState = "checking" | "authed" | "guest";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let cancelled = false;
    const loadMe = async () => {
      try {
        const res = await fetch("/api/me");
        if (!cancelled) setAuthState(res.ok ? "authed" : "guest");
      } catch (e) {
        console.error("Failed to check auth:", e);
        if (!cancelled) setAuthState("guest");
      }
    };
    loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthed = useCallback(() => {
    setAuthState("authed");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (e) {
      console.error("Failed to log out:", e);
    } finally {
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

  return <AuthenticatedApp onLogout={handleLogout} />;
}
