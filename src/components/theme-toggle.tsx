import { useCallback, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light/dark toggle. Writes the `data-mode` attribute on <html> (the mechanism
 * index.html boots from and styles.css's @custom-variant keys off), so the whole
 * app re-themes via CSS variables without a re-render.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );
  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      const mode = next ? "dark" : "light";
      document.documentElement.setAttribute("data-mode", mode);
      document.documentElement.style.colorScheme = mode;
      localStorage.setItem("theme", mode);
      return next;
    });
  }, []);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Đổi giao diện sáng/tối"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
