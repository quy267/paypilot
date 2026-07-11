import type { ReactNode } from "react";
import {
  Compass,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Users
} from "lucide-react";
import type { AppRoute } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/services/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

interface AppShellProps {
  route: AppRoute;
  username: string;
  role: UserRole;
  onNavigate: (route: AppRoute) => void;
  onLogout: () => void;
  children: ReactNode;
}

const navigation: Array<{
  route: AppRoute;
  label: string;
  icon: typeof Inbox;
  adminOnly?: boolean;
}> = [
  { route: "inbox", label: "Hộp xử lý", icon: Inbox },
  { route: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { route: "decisions", label: "Lịch sử", icon: History },
  { route: "users", label: "Quản lý user", icon: Users, adminOnly: true }
];

const routeTitles: Record<AppRoute, string> = {
  inbox: "Hộp xử lý",
  dashboard: "Tổng quan",
  decisions: "Lịch sử quyết định",
  users: "Quản lý user"
};

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  operator: "Vận hành",
  viewer: "Chỉ xem"
};

export function AppShell({
  route,
  username,
  role,
  onNavigate,
  onLogout,
  children
}: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden [contain:layout_paint] bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Compass className="size-[18px]" />
          </div>
          <span className="text-lg font-semibold tracking-tight">PayPilot</span>
        </div>

        <nav aria-label="Điều hướng chính" className="space-y-1 p-3">
          {navigation
            .filter((item) => !item.adminOnly || role === "admin")
            .map((item) => {
              const active = route === item.route;
              const Icon = item.icon;
              return (
                <a
                  key={item.route}
                  href={`#/${item.route}`}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(item.route);
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </a>
              );
            })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5">
          <h1 className="text-lg font-semibold tracking-tight">
            {routeTitles[route]}
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="max-w-24 truncate text-sm font-medium sm:max-w-40">
                {username}
              </span>
              <Badge variant="outline">{roleLabels[role]}</Badge>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut /> Đăng xuất
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
