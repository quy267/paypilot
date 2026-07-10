import { useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LoginScreenProps {
  onAuthed: () => void;
}

export function LoginScreen({ onAuthed }: LoginScreenProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setError(false);
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key })
        });
        if (res.ok) {
          onAuthed();
          return;
        }
        if (res.status === 401) setError(true);
      } catch (e) {
        console.error("Failed to log in:", e);
        setError(true);
      } finally {
        setSubmitting(false);
      }
    },
    [key, onAuthed]
  );

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader>
          <CardTitle className="text-xl">PayPilot</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-card-foreground"
                htmlFor="owner-key"
              >
                Mật khẩu
              </label>
              <input
                id="owner-key"
                type="password"
                aria-label="Mật khẩu"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">Sai mật khẩu</p>}
            <Button className="w-full" type="submit" disabled={submitting}>
              Đăng nhập
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
