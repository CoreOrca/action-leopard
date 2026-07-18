"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createNewProject,
  duplicateProject,
  setProjectArchived,
} from "@/lib/projects";
import type { Project, ProjectType } from "@/lib/types";

export default function StudioPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setProjects((data as Project[]) ?? []);
        setLoading(false);
      });
  }, []);

  async function createProject(type: ProjectType) {
    setChooserOpen(false);
    const id = await createNewProject(type);
    if (id) router.push(`/studio/${id}`);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its assets records?")) return;
    const supabase = createClient();
    await supabase.from("projects").delete().eq("id", id);
    setProjects((p) => p.filter((x) => x.id !== id));
  }

  async function toggleArchived(p: Project) {
    await setProjectArchived(p.id, !p.archived);
    setProjects((list) =>
      list.map((x) => (x.id === p.id ? { ...x, archived: !p.archived } : x))
    );
  }

  async function duplicate(id: string) {
    setDuplicating(id);
    try {
      const newId = await duplicateProject(id);
      if (newId) router.push(`/studio/${newId}`);
      else alert("Duplicate failed");
    } finally {
      setDuplicating(null);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border-soft px-6 h-14">
        <span className="font-mono tracking-[0.3em] text-sm">ACTION LEOPARD</span>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-muted">{email}</span>
          <button
            onClick={signOut}
            className="border border-border px-3 py-1 font-mono text-xs uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-sm uppercase tracking-widest text-muted">
              Projects
            </h1>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                showArchived
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-soft text-muted hover:border-border"
              }`}
            >
              Archived
            </button>
          </div>
          <div className="relative">
            <button
              onClick={() => setChooserOpen((o) => !o)}
              className="border border-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
            >
              + New project
            </button>
            {chooserOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-56 border border-border bg-background">
                <button
                  onClick={() => createProject("shot")}
                  className="block w-full border-b border-border-soft px-4 py-3 text-left font-mono text-[11px] uppercase tracking-wider hover:bg-foreground hover:text-background"
                >
                  Single shot
                  <span className="mt-0.5 block text-[9px] normal-case tracking-normal opacity-60">
                    Fix one shot's action by hand
                  </span>
                </button>
                <button
                  onClick={() => createProject("scene")}
                  className="block w-full px-4 py-3 text-left font-mono text-[11px] uppercase tracking-wider hover:bg-foreground hover:text-background"
                >
                  Create a scene
                  <span className="mt-0.5 block text-[9px] normal-case tracking-normal opacity-60">
                    Agent plans shots from your script
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <p className="font-mono text-xs text-muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="font-mono text-xs text-muted">
            No projects yet. Create one to begin.
          </p>
        ) : (
          <ul className="divide-y divide-border-soft border border-border-soft">
            {projects
              .filter((p) => !!p.archived === showArchived)
              .map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-panel cursor-pointer group"
                onClick={() => router.push(`/studio/${p.id}`)}
              >
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    {p.name}
                    {p.project_type === "scene" && (
                      <span className="border border-border-soft px-1 py-px font-mono text-[9px] uppercase tracking-wider text-muted">
                        Scene
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-muted mt-0.5">
                    {new Date(p.updated_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicate(p.id);
                    }}
                    disabled={duplicating === p.id}
                    className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border disabled:opacity-40"
                    title="Copy intent, script, art direction, locations, and elements into a new project"
                  >
                    {duplicating === p.id ? "…" : "Duplicate"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleArchived(p);
                    }}
                    className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                  >
                    {p.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProject(p.id);
                    }}
                    className="border border-danger px-2 py-1 font-mono text-[10px] uppercase text-danger"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
