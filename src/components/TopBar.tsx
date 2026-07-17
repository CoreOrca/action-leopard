"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/models";
import { useWorkspace } from "@/lib/store";

export default function TopBar({
  onPatchProject,
}: {
  onPatchProject: (patch: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const { project, patchProject } = useWorkspace();
  const [email, setEmail] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
    setDark(document.documentElement.classList.contains("dark"));
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("al-theme", next ? "dark" : "light");
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="relative z-40 flex h-12 items-center justify-between border-b border-border-soft bg-background px-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          aria-label="Menu"
          className="flex h-8 w-8 flex-col items-center justify-center gap-[5px] border border-border-soft hover:border-border"
        >
          <span className="block h-px w-4 bg-foreground" />
          <span className="block h-px w-4 bg-foreground" />
          <span className="block h-px w-4 bg-foreground" />
        </button>
        <span className="font-mono text-xs tracking-[0.3em]">ACTION LEOPARD</span>
        {project && (
          <input
            value={project.name}
            onChange={(e) => {
              patchProject({ name: e.target.value });
              onPatchProject({ name: e.target.value });
            }}
            className="ml-4 w-56 border-b border-transparent bg-transparent text-sm outline-none focus:border-border-soft"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={project?.image_model ?? "nano-banana-pro"}
          onChange={(e) => {
            patchProject({ image_model: e.target.value });
            onPatchProject({ image_model: e.target.value });
          }}
          className="border border-border-soft bg-background px-2 py-1 font-mono text-[11px] outline-none hover:border-border"
          title="Image model"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              IMG · {m.label}
            </option>
          ))}
        </select>
        <select
          value={project?.video_model ?? "grok-imagine-1.5-720p"}
          onChange={(e) => {
            patchProject({ video_model: e.target.value });
            onPatchProject({ video_model: e.target.value });
          }}
          className="border border-border-soft bg-background px-2 py-1 font-mono text-[11px] outline-none hover:border-border"
          title="Video model"
        >
          {VIDEO_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              VID · {m.label}
            </option>
          ))}
        </select>

        <button
          onClick={toggleTheme}
          className="border border-border-soft px-2 py-1 font-mono text-[11px] uppercase hover:border-border"
          title="Toggle theme"
        >
          {dark ? "Light" : "Dark"}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="border border-border-soft px-3 py-1 font-mono text-[11px] hover:border-border"
          >
            {email || "…"} ▾
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 border border-border bg-background">
              <Link
                href="/studio"
                className="block px-3 py-2 font-mono text-[11px] uppercase tracking-wider hover:bg-foreground hover:text-background"
              >
                Projects
              </Link>
              <button
                onClick={signOut}
                className="block w-full px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider hover:bg-foreground hover:text-background"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {drawerOpen && (
        <nav className="absolute left-0 top-full h-[calc(100vh-3rem)] w-56 border-r border-border-soft bg-background">
          <Link
            href="/studio"
            className="block border-b border-border-soft px-4 py-3 font-mono text-[11px] uppercase tracking-wider hover:bg-foreground hover:text-background"
          >
            ← All projects
          </Link>
          <div className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted">
            {project?.name}
          </div>
        </nav>
      )}
    </header>
  );
}
