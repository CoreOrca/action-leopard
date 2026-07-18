"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/store";
import { imageToCanvasBackground } from "@/lib/canvas";
import type { Asset, Element, Project } from "@/lib/types";
import TopBar from "./TopBar";
import SidePanel from "./SidePanel";
import CanvasPanel from "./CanvasPanel";
import PreviewPanel from "./PreviewPanel";
import PromptBar from "./PromptBar";
import VideoStrip from "./VideoStrip";
import AgentModal from "./AgentModal";

export default function Workspace({ projectId }: { projectId: string }) {
  const {
    project,
    setProject,
    setElements,
    setAssets,
    busy,
  } = useWorkspace();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const patchTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase
        .from("elements")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at"),
      supabase
        .from("assets")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
    ]).then(([p, e, a]) => {
      setProject((p.data as Project) ?? null);
      setElements((e.data as Element[]) ?? []);
      setAssets((a.data as Asset[]) ?? []);
      setLoaded(true);
    });
    return () => {
      setProject(null);
      setElements([]);
      setAssets([]);
    };
  }, [projectId, setProject, setElements, setAssets]);

  /** Debounced autosave of project fields, keyed per field group. */
  const patchProject = useCallback(
    (patch: Record<string, unknown>) => {
      const key = Object.keys(patch).join(",");
      if (patchTimer.current[key]) clearTimeout(patchTimer.current[key]);
      patchTimer.current[key] = setTimeout(async () => {
        await createClient().from("projects").update(patch).eq("id", projectId);
      }, 800);
    },
    [projectId]
  );

  const onSnapshotChange = useCallback(
    (snapshot: unknown) => {
      useWorkspace.getState().patchProject({ canvas_snapshot: snapshot });
      patchProject({ canvas_snapshot: snapshot });
    },
    [patchProject]
  );

  const onAnnotate = useCallback(
    (url: string) => {
      if (editor) imageToCanvasBackground(editor, url);
    },
    [editor]
  );

  if (!loaded || !project) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <span className="font-mono text-xs text-muted">
          {loaded ? "Project not found." : "Loading…"}
        </span>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <TopBar onPatchProject={patchProject} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <SidePanel projectId={projectId} onPatchProject={patchProject} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
          <div className="flex min-h-0 min-w-0 flex-1 gap-2">
            <CanvasPanel
              projectId={projectId}
              onEditorReady={setEditor}
              onSnapshotChange={onSnapshotChange}
              onPatchProject={patchProject}
            />
            <PreviewPanel projectId={projectId} onAnnotate={onAnnotate} />
          </div>
          <PromptBar projectId={projectId} onPatchProject={patchProject} />
          <VideoStrip />
        </div>
      </div>

      {busy && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-border bg-background px-4 py-2 font-mono text-[11px]">
          {busy}
        </div>
      )}

      <AgentModal projectId={projectId} editor={editor} />
    </main>
  );
}
