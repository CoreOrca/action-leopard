"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(
    searchParams.get("error") === "confirm"
      ? "Confirmation link invalid or expired."
      : null
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setStatus(error.message);
      else {
        router.push("/studio");
        router.refresh();
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });
      if (error) {
        setStatus(error.message);
      } else if (data.session) {
        router.push("/studio");
        router.refresh();
      } else {
        // No session — email confirmation is still enabled in Supabase.
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) setStatus(signInError.message);
        else {
          router.push("/studio");
          router.refresh();
        }
      }
    }
    setBusy(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm border border-border p-8">
        <h1 className="font-mono text-lg tracking-widest mb-1">ACTION LEOPARD</h1>
        <p className="text-xs text-muted mb-8 font-mono">
          spatial control for generated action
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase tracking-wider">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </label>
          <label className="text-xs font-mono uppercase tracking-wider">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-4 border border-foreground px-4 py-2 text-sm font-mono uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {status && (
          <p className="mt-4 text-xs font-mono text-muted">{status}</p>
        )}

        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setStatus(null);
          }}
          className="mt-6 text-xs font-mono underline underline-offset-4 text-muted hover:text-foreground"
        >
          {mode === "signin"
            ? "No account? Create one"
            : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
