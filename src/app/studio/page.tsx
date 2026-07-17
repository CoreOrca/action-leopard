"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";

export default function StudioPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");

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

  async function createProject() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name: "Untitled project" })
      .select()
      .single();
    if (!error && data) router.push(`/studio/${data.id}`);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its assets records?")) return;
    const supabase = createClient();
    await supabase.from("projects").delete().eq("id", id);
    setProjects((p) => p.filter((x) => x.id !== id));
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
          <h1 className="font-mono text-sm uppercase tracking-widest text-muted">
            Projects
          </h1>
          <button
            onClick={createProject}
            className="border border-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
          >
            + New project
          </button>
        </div>

        {loading ? (
          <p className="font-mono text-xs text-muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="font-mono text-xs text-muted">
            No projects yet. Create one to begin.
          </p>
        ) : (
          <ul className="divide-y divide-border-soft border border-border-soft">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-panel cursor-pointer group"
                onClick={() => router.push(`/studio/${p.id}`)}
              >
                <div>
                  <div className="text-sm">{p.name}</div>
                  <div className="font-mono text-[10px] text-muted mt-0.5">
                    {new Date(p.updated_at).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProject(p.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 font-mono text-[10px] uppercase text-danger border border-danger px-2 py-1"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
