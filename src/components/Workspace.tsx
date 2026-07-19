"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import { imageToCanvasBackground } from "@/lib/canvas";
import type { Asset, Element, Project, Shot } from "@/lib/types";
import TopBar from "./TopBar";
import SidePanel from "./SidePanel";
import CanvasPanel from "./CanvasPanel";
import PreviewPanel from "./PreviewPanel";
import PromptBar from "./PromptBar";
import VideoStrip from "./VideoStrip";
import AgentModal from "./AgentModal";
import ShotsCanvas from "./ShotsCanvas";
import SceneAgentPanel from "./SceneAgentPanel";
import {
  planScene,
  computeResume,
  runScene,
  retryShot,
  acceptShot,
  makeVideos,
  makeEndFrames,
  cancelRun,
  replanScene,
  approveShotFrame,
  uploadShotStartFrame,
} from "@/lib/scene-agent";

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
      supabase
        .from("shots")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
    ]).then(([p, e, a, s]) => {
      setProject((p.data as Project) ?? null);
      setElements((e.data as Element[]) ?? []);
      setAssets((a.data as Asset[]) ?? []);
      const shots = (s.data as Shot[]) ?? [];
      useSceneAgent.getState().setShots(shots);
      if ((p.data as Project)?.project_type === "scene") {
        useSceneAgent.getState().setPhase(computeResume(shots).phase);
        // Fresh scene: open the Action scene maker so its intake walks the
        // user through script/intent/locations.
        if (!shots.length) useSceneAgent.getState().setPanelOpen(true);
      }
      setLoaded(true);
    });
    return () => {
      setProject(null);
      setElements([]);
      setAssets([]);
      useSceneAgent.getState().resetScene();
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

  const isScene = project.project_type === "scene";

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <TopBar onPatchProject={patchProject} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <SidePanel projectId={projectId} onPatchProject={patchProject} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
          {isScene && <SceneTabs />}
          {isScene && <SceneShotsPane projectId={projectId} />}
          {/* Fix-it view: kept mounted across tab flips so the tldraw editor
              and canvas snapshot lifecycle never re-fire. */}
          <FixitPane isScene={isScene}>
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
          </FixitPane>
        </div>
      </div>

      {busy && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-border bg-background px-4 py-2 font-mono text-[11px]">
          {busy}
        </div>
      )}

      <AgentModal projectId={projectId} editor={editor} />
      {isScene && (
        <SceneAgentPanel
          onGenerate={(dryRun) => runScene({ dryRun })}
          onResume={() => runScene()}
          onCancel={() => cancelRun()}
          onReplan={() => replanScene()}
          onMakeEndFrames={() => makeEndFrames()}
          onMakeVideos={() => makeVideos()}
          onRetryShot={(id) => retryShot(id)}
          onAcceptShot={(id) => acceptShot(id)}
          onApproveVersion={(id, assetId) => approveShotFrame(id, assetId)}
          onUploadFrame={(id, file) => uploadShotStartFrame(projectId, id, file)}
          onPlanScene={() => planScene()}
          onPatchProject={patchProject}
        />
      )}
    </main>
  );
}

/** Tab strip for scene projects: shots canvas vs the per-shot detail view.
 *  The center cell hosts the shots-canvas toolbar (portaled from ShotsCanvas). */
function SceneTabs() {
  const { view, setView, activeShotId, shots } = useSceneAgent();
  const active = shots.find((s) => s.id === activeShotId);
  const activeIndex = active ? shots.indexOf(active) + 1 : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
      <div className="flex min-w-0 items-center gap-0 overflow-hidden">
        {(["shots", "fixit"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`shrink-0 whitespace-nowrap border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
              view === v
                ? "border-foreground bg-foreground text-background"
                : "border-border-soft text-muted hover:border-border"
            }`}
          >
            {v === "shots" ? "Shots" : "Shot detail"}
          </button>
        ))}
      </div>
      {/* Center cell: shots-canvas toolbar (portal) in shots view; the
          scoped shot's number + name in shot detail — never wraps. */}
      <div className="flex min-w-0 items-center justify-center overflow-hidden">
        <div id="scene-toolbar-slot" className="flex justify-center" />
        {view === "fixit" && active && (
          <button
            onClick={() => setView("shots")}
            className="max-w-[40vw] truncate whitespace-nowrap font-mono text-[10px] uppercase tracking-widest hover:text-muted"
            title="Back to the shots canvas"
          >
            Shot {activeIndex}
            {active.title ? ` — ${active.title}` : ""}
          </button>
        )}
      </div>
      <ExportButton />
    </div>
  );
}

/** Downloads a zip: every asset in organized folders + prompts.md. */
function ExportButton() {
  const busy = useWorkspace((s) => s.busy);
  async function exportNow() {
    const { project, elements, assets, setBusy } = useWorkspace.getState();
    const shots = useSceneAgent.getState().shots;
    if (!project) return;
    setBusy("Packing export…");
    try {
      const { exportProject } = await import("@/lib/export");
      await exportProject({
        project,
        shots,
        elements,
        assets,
        onProgress: (m) => useWorkspace.getState().setBusy(m),
      });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      useWorkspace.getState().setBusy(null);
    }
  }
  return (
    <div className="flex justify-end">
      <button
        onClick={exportNow}
        disabled={!!busy}
        className="border border-border-soft px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-border hover:text-foreground disabled:opacity-40"
        title="Download the project as a zip — inputs, per-shot frames and clips, generated media, and prompts.md"
      >
        ⤓ Export
      </button>
    </div>
  );
}

function SceneShotsPane({ projectId }: { projectId: string }) {
  const view = useSceneAgent((s) => s.view);
  return (
    <div className={view === "shots" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
      <ShotsCanvas projectId={projectId} onMakeVideo={() => makeVideos()} />
    </div>
  );
}

/**
 * Hosts the manual fix-it stack. For single-shot projects it renders children
 * directly (unchanged DOM). For scene projects it mounts them lazily on the
 * first visit to the fix-it tab (so tldraw never mounts at 0×0), then keeps
 * them mounted-but-hidden so the editor survives tab flips.
 */
function FixitPane({
  isScene,
  children,
}: {
  isScene: boolean;
  children: React.ReactNode;
}) {
  const view = useSceneAgent((s) => s.view);
  const [everShown, setEverShown] = useState(!isScene);
  useEffect(() => {
    if (isScene && view === "fixit") setEverShown(true);
  }, [isScene, view]);
  if (!isScene) return <>{children}</>;
  if (!everShown) return null;
  return (
    <div className={view === "fixit" ? "contents" : "hidden"}>{children}</div>
  );
}
