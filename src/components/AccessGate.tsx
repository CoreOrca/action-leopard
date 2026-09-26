"use client";

import { useState } from "react";

export function AccessGate() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      window.location.href = "/login";
      return;
    }
    setStatus("That code is not valid.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-10 flex w-full max-w-xs flex-col items-center gap-4">
      <label className="w-full text-xs font-mono uppercase tracking-wider text-muted">
        User code
        <input
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-1 w-full border border-foreground bg-transparent px-3 py-2 text-sm tracking-widest outline-none focus:border-foreground"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="border border-foreground px-8 py-3 font-mono text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors disabled:opacity-50"
      >
        {busy ? "…" : "Enter"}
      </button>
      {status && <p className="text-xs font-mono text-muted">{status}</p>}
      <p className="text-center text-xs font-mono text-muted">
        Request a code{" "}
        <a
          href="mailto:cortney@cortneyharrington.com"
          className="underline underline-offset-4 hover:text-foreground"
        >
          cortney@cortneyharrington.com
        </a>
      </p>
    </form>
  );
}
