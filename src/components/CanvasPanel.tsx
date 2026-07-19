"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "tldraw/tldraw.css";
import { getSnapshot, loadSnapshot, type Editor } from "tldraw";
import { useWorkspace } from "@/lib/store";
import { useShotScope } from "@/lib/shot-scope";
import {
  clearCanvas,
  cutoutsToCanvas,
  exportCanvasPng,
  imageToCanvasBackground,
  saveBlobAsAsset,
  sceneToCanvas,
  uploadBlobOnly,
  type CutoutPiece,
} from "@/lib/canvas";
import {
  assignAtlasColors,
  cutoutFromMask,
  cutoutsFromAtlas,
  hasMobileSubjects,
  isStickerObject,
  traceMask,
} from "@/lib/segment";
import type {
  SceneMode,
  SceneObject,
  SceneQuality,
  SceneTranslation,
} from "@/lib/types";
import type { Asset } from "@/lib/types";

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
  const {
    scoped,
    previewAsset,
    referenceUrl,
    intent: scopeIntent,
  } = useShotScope();
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("cutouts");
  const [sceneQuality, setSceneQuality] = useState<SceneQuality>("cinematic");

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
      requestAnimationFrame(() =>
        editor.zoomToFit({ animation: { duration: 0 } })
      );

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

  async function loadImageDims(
    url: string
  ): Promise<{ w: number; h: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not load reference image"));
      img.src = url;
    });
  }

  // What ✦ Scene operates on. Scene projects work from whatever the Preview
  // panel is showing (a shot frame, a location, an upload) — they have no
  // single reference image. Single-shot projects keep the reference-driven
  // path unchanged.
  const isScene = project?.project_type === "scene";
  const previewImageUrl =
    previewAsset && previewAsset.type !== "video" ? previewAsset.url : null;
  const sourceUrl =
    scoped || isScene
      ? previewImageUrl ?? referenceUrl
      : project?.reference_image_url ?? null;

  async function translateScene() {
    const editor = editorRef.current;
    if (!editor || !sourceUrl) {
      alert(
        scoped || isScene
          ? "Select an image in the preview first."
          : "Upload a reference image first (left panel)."
      );
      return;
    }
    setBusy("Reading the location…");
    try {
      const translateMode = sceneMode === "outlines" ? "outlines" : "blocks";
      const res = await fetch("/api/scene/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: sourceUrl,
          intent: scopeIntent,
          mode: translateMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "translate failed");
      const scene = data.scene as SceneTranslation;

      if (sceneMode === "traced" || sceneMode === "cutouts") {
        await buildSegmentedScene(
          editor,
          sourceUrl,
          scene,
          sceneMode,
          sceneQuality
        );
      } else {
        await sceneToCanvas(editor, scene);
      }

      // Scoped translations serve one shot — never overwrite the project's
      // plan-authored scene_meta (summary, anchors, invariants). Unscoped,
      // merge so scene-project invariants survive.
      if (!scoped) {
        const scene_meta = {
          ...(useWorkspace.getState().project?.scene_meta ?? {}),
          summary: scene.summary,
          scale_anchors: scene.scale_anchors ?? [],
        };
        patchProject({ scene_meta });
        onPatchProject({ scene_meta });
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function requestWorld(
    mode: "plate" | "atlas",
    imageUrl: string,
    extra: Record<string, unknown>
  ): Promise<{ url: string | null; assets?: Asset[] }> {
    const modelId =
      useWorkspace.getState().project?.image_model ?? "nano-banana-pro";
    const res = await fetch("/api/scene/world", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        imageUrl,
        projectId,
        modelId,
        ...extra,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `${mode} generation failed`);
    if (data.assets?.length) addAssets(data.assets as Asset[]);
    return { url: data.url ?? null, assets: data.assets };
  }

  async function segmentWithSam(
    referenceUrl: string,
    targets: SceneObject[],
    dims: { w: number; h: number }
  ): Promise<Map<string, string | null>> {
    const segRes = await fetch("/api/scene/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: referenceUrl,
        imageW: dims.w,
        imageH: dims.h,
        boxes: targets.map((o) => ({
          id: o.id,
          label: o.label,
          kind: o.kind,
          x_min: o.x * dims.w,
          y_min: o.y * dims.h,
          x_max: (o.x + o.w) * dims.w,
          y_max: (o.y + o.h) * dims.h,
        })),
      }),
    });
    const segData = await segRes.json();
    if (!segRes.ok) throw new Error(segData.error ?? "segmentation failed");
    return new Map(
      (segData.masks as { id: string; maskUrl: string | null }[]).map((m) => [
        m.id,
        m.maskUrl,
      ])
    );
  }

  async function buildSegmentedScene(
    editor: Editor,
    referenceUrl: string,
    scene: SceneTranslation,
    mode: "traced" | "cutouts",
    quality: SceneQuality
  ) {
    const dims = await loadImageDims(referenceUrl);

    const targets =
      mode === "cutouts"
        ? scene.objects.filter((o) => isStickerObject(o))
        : scene.objects.filter((o) => o.kind !== "sky");

    if (!targets.length && mode === "cutouts") {
      await sceneToCanvas(editor, scene);
      return;
    }

    // ── Traced path (SAM + improved contour) ───────────────────────────
    if (mode === "traced") {
      setBusy(`Segmenting ${targets.length} objects…`);
      const maskByid = await segmentWithSam(referenceUrl, targets, dims);
      setBusy("Tracing silhouettes…");
      const withOutlines: SceneObject[] = [];
      for (const obj of targets) {
        const maskUrl = maskByid.get(obj.id);
        let traced = null;
        if (maskUrl) {
          try {
            traced = await traceMask(maskUrl);
          } catch {
            traced = null;
          }
        }
        withOutlines.push(
          traced
            ? {
                ...obj,
                outline: traced.polygon.map(
                  ([px, py]) =>
                    [px / traced!.imageW, py / traced!.imageH] as [
                      number,
                      number,
                    ]
                ),
              }
            : obj
        );
      }
      const rest = scene.objects.filter((o) => o.kind === "sky");
      await sceneToCanvas(editor, {
        ...scene,
        objects: [...rest, ...withOutlines],
      });
      return;
    }

    // ── Cutouts path ───────────────────────────────────────────────────
    const stickerIds = new Set(targets.map((o) => o.id));
    const backdrop = scene.objects
      .filter((o) => !stickerIds.has(o.id))
      .map((o) => {
        const { outline: _drop, ...rest } = o;
        void _drop;
        return rest as SceneObject;
      });

    const subjects = hasMobileSubjects(scene.objects);
    const cinematic = quality === "cinematic";

    let plateUrl: string | null = null;

    // Empty plate when the photo has cars/people to rearrange
    if (subjects) {
      setBusy("Building empty location plate…");
      try {
        const subjectLabels = scene.objects
          .filter(
            (o) =>
              o.mobile ||
              o.kind === "vehicle" ||
              o.kind === "character" ||
              o.kind === "prop"
          )
          .map((o) => o.label);
        const plate = await requestWorld("plate", referenceUrl, {
          subjectLabels,
        });
        plateUrl = plate.url;
      } catch (err) {
        console.warn("plate generation failed, continuing without", err);
      }
    }

    const pieces: CutoutPiece[] = [];
    const gotIds = new Set<string>();

    // Cinematic: Scene Atlas (flat color map) → color-key stickers
    if (cinematic && targets.length) {
      setBusy("Painting scene atlas…");
      try {
        const legend = assignAtlasColors(targets);
        const atlas = await requestWorld("atlas", referenceUrl, {
          objects: legend,
        });
        if (atlas.url) {
          setBusy("Cutting stickers from atlas…");
          const extracted = await cutoutsFromAtlas(
            referenceUrl,
            atlas.url,
            legend
          );
          let done = 0;
          for (const piece of extracted) {
            done++;
            setBusy(`Uploading stickers… ${done}/${extracted.length}`);
            const url = await uploadBlobOnly(
              piece.blob,
              `projects/${projectId}/cutouts/${piece.id}.png`
            );
            pieces.push({
              label: piece.label,
              kind: piece.kind,
              mobile: piece.mobile,
              url,
              bbox: piece.bbox,
            });
            gotIds.add(piece.id);
          }
        }
      } catch (err) {
        console.warn("atlas path failed, falling back to SAM", err);
      }
    }

    // SAM for anything the atlas missed (or entire Fast path)
    const needSam = targets.filter((t) => !gotIds.has(t.id));
    if (needSam.length) {
      setBusy(`Segmenting ${needSam.length} objects…`);
      const maskByid = await segmentWithSam(referenceUrl, needSam, dims);
      let done = 0;
      for (const obj of needSam) {
        const maskUrl = maskByid.get(obj.id);
        done++;
        if (!maskUrl) continue;
        setBusy(`Cutting pieces… ${done}/${needSam.length}`);
        try {
          const cut = await cutoutFromMask(referenceUrl, maskUrl);
          if (!cut) continue;
          const url = await uploadBlobOnly(
            cut.blob,
            `projects/${projectId}/cutouts/${obj.id}.png`
          );
          pieces.push({
            label: obj.label,
            kind: obj.kind,
            mobile: obj.mobile,
            url,
            bbox: cut.bbox,
          });
          gotIds.add(obj.id);
        } catch {
          // skip
        }
      }
    }

    if (!pieces.length) {
      await sceneToCanvas(editor, scene);
      return;
    }

    // Assemble: clear → plate or blocks → stickers
    setBusy("Assembling the scene…");
    clearCanvas(editor);

    if (plateUrl) {
      await imageToCanvasBackground(editor, plateUrl, {
        fitStage: true,
        imageW: dims.w,
        imageH: dims.h,
        source: "scene-plate",
        locked: true,
      });
    } else if (backdrop.length) {
      await sceneToCanvas(
        editor,
        { ...scene, objects: backdrop },
        { animate: false, legend: false }
      );
    }

    await cutoutsToCanvas(editor, {
      pieces,
      imageW: dims.w,
      imageH: dims.h,
      scene,
    });
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

  const showQuality = sceneMode === "cutouts";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-border-soft">
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
            <option value="cutouts">Cutouts</option>
            <option value="traced">Traced</option>
            <option value="outlines">Outlines</option>
            <option value="blocks">Blocks</option>
          </select>
          <select
            value={sceneQuality}
            onChange={(e) => setSceneQuality(e.target.value as SceneQuality)}
            disabled={!showQuality}
            aria-hidden={!showQuality}
            className="border border-border-soft bg-background px-1 py-1 font-mono text-[10px] uppercase outline-none hover:border-border disabled:cursor-default disabled:border-border-soft disabled:text-muted disabled:opacity-40 disabled:hover:border-border-soft"
            title={
              showQuality
                ? "Fast: SAM stickers. Cinematic: image-model atlas + empty plate when subjects are present (uses image credits)."
                : "Quality applies to Cutouts mode only."
            }
          >
            <option value="cinematic">Cinematic</option>
            <option value="fast">Fast</option>
          </select>
          <button
            onClick={translateScene}
            disabled={!!busy || !sourceUrl}
            className="whitespace-nowrap border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
            title={
              scoped || isScene
                ? "Translate the previewed image into movable objects"
                : "Translate the reference image into movable objects"
            }
          >
            ✦ Scene
          </button>
          <button
            onClick={screenshotToAsset}
            disabled={!!busy}
            className="whitespace-nowrap border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
            title="Save the current canvas as a shot"
          >
            Save
          </button>
          <button
            onClick={() => editorRef.current && clearCanvas(editorRef.current)}
            className="whitespace-nowrap border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-border"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="isolate relative z-0 min-h-0 flex-1">
        <Tldraw
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
          onMount={handleMount}
        />
      </div>
    </section>
  );
}
