"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "tldraw/tldraw.css";
import { getSnapshot, loadSnapshot, type Editor } from "tldraw";
import { useWorkspace } from "@/lib/store";
import {
  clearCanvas,
  exportCanvasPng,
  saveBlobAsAsset,
  sceneToCanvas,
} from "@/lib/canvas";
import type { SceneMode, SceneTranslation } from "@/lib/types";

const Tldraw = dynamic(async () => (await import("tldraw")).Tldraw, {
  ssr: false,
});

export default function CanvasPanel({
  projectId,
  onEditorReady,
  onSnapshotChange,
  onPatchProject,
}: {
  projectId: string;
  onEditorReady: (editor: Editor) => void;
  onSnapshotChange: (snapshot: unknown) => void;
  onPatchProject: (patch: Record<string, unknown>) => void;
}) {
  const { project, patchProject, addAssets, setBusy, busy, assets } =
    useWorkspace();
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("outlines");

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      onEditorReady(editor);

      const syncTheme = () =>
        editor.user.updateUserPreferences({
          colorScheme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
        });
      syncTheme();
      // Follow the app's theme toggle live.
      const observer = new MutationObserver(syncTheme);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      const snap = useWorkspace.getState().project?.canvas_snapshot;
      if (snap) {
        try {
          loadSnapshot(editor.store, snap as Parameters<typeof loadSnapshot>[1]);
        } catch {
          // corrupted snapshot; start clean
        }
      }
      // The snapshot has no camera state — frame the content on open.
      requestAnimationFrame(() => editor.zoomToFit({ animation: { duration: 0 } }));

      editor.store.listen(
        () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            const { document } = getSnapshot(editor.store);
            onSnapshotChange(document);
          }, 1200);
        },
        { scope: "document", source: "user" }
      );
    },
    [onEditorReady, onSnapshotChange]
  );

  async function translateScene() {
    const editor = editorRef.current;
    const ref = useWorkspace.getState().project?.reference_image_url;
    if (!editor || !ref) {
      alert("Upload a reference image first (left panel).");
      return;
    }
    setBusy("Translating location into scene…");
    try {
      const res = await fetch("/api/scene/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: ref,
          intent: useWorkspace.getState().project?.intent ?? "",
          mode: sceneMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "translate failed");
      const scene = data.scene as SceneTranslation;
      await sceneToCanvas(editor, scene);
      // Persist scale anchors so the prompt writer can cite them.
      const scene_meta = {
        summary: scene.summary,
        scale_anchors: scene.scale_anchors ?? [],
      };
      patchProject({ scene_meta });
      onPatchProject({ scene_meta });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function screenshotToAsset() {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy("Saving canvas shot…");
    try {
      const blob = await exportCanvasPng(editor);
      const maxSort = Math.max(0, ...assets.map((a) => a.sort_order));
      const asset = await saveBlobAsAsset(blob, {
        projectId,
        type: "canvas-shot",
        pathname: `projects/${projectId}/canvas/shot.png`,
        metadata: { source: "canvas" },
        sortOrderHint: maxSort + 1,
      });
      addAssets([asset]);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-border-soft">
      <div className="flex items-center justify-between border-b border-border-soft px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Canvas — blocking &amp; sketch
        </span>
        <div className="flex gap-1">
          <select
            value={sceneMode}
            onChange={(e) => setSceneMode(e.target.value as SceneMode)}
            className="border border-border-soft bg-background px-1 py-1 font-mono text-[10px] uppercase outline-none hover:border-border"
            title="How the reference image is rendered onto the canvas"
          >
            <option value="outlines">Outlines</option>
            <option value="blocks">Blocks</option>
            <option value="traced" disabled>
              Traced (soon)
            </option>
          </select>
          <button
            onClick={translateScene}
            disabled={!!busy || !project?.reference_image_url}
            className="border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
            title="Translate the reference image into movable objects"
          >
            ✦ Scene from image
          </button>
          <button
            onClick={screenshotToAsset}
            disabled={!!busy}
            className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
          >
            Save shot
          </button>
          <button
            onClick={() => editorRef.current && clearCanvas(editorRef.current)}
            className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-border"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="isolate relative z-0 min-h-0 flex-1">
        <Tldraw onMount={handleMount} />
      </div>
    </section>
  );
}
