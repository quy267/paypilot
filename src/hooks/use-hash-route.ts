import { useCallback, useEffect, useState } from "react";

export type AppRoute = "inbox" | "dashboard" | "decisions" | "users";

function readHashRoute(): AppRoute {
  const route = window.location.hash.replace(/^#\/?/, "");
  if (route === "dashboard" || route === "decisions" || route === "users") {
    return route;
  }
  return "inbox";
}

export function useHashRoute() {
  const [route, setRoute] = useState<AppRoute>(readHashRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(readHashRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    window.location.hash = `#/${nextRoute}`;
  }, []);

  return { route, navigate };
}
