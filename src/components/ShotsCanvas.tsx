"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import { insertShot, patchShot, deleteShot, reorderShots } from "@/lib/shots";
import { saveBlobAsAsset } from "@/lib/canvas";
import type { Shot } from "@/lib/types";

const COLS = 4;
const CARD_W = 320;
const CARD_H = 180; // 16:9
const GAP = 36;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

const STATUS_LABEL: Partial<Record<Shot["status"], string>> = {
  generating: "generating…",
  judging: "judging…",
  fixing: "fixing…",
  escalated: "needs you",
  accepted: "accepted",
};

export default function ShotsCanvas({
  projectId,
  onImagesFromScript,
  onMakeVideo,
}: {
  projectId: string;
  onImagesFromScript?: () => void;
  onMakeVideo?: () => void;
}) {
  const { assets, addAssets, setBusy, busy } = useWorkspace();
  const {
    shots,
    activeShotId,
    setActiveShot,
    setView,
    setShots,
    addShots,
    removeShot,
    patchShotLocal,
  } = useSceneAgent();

  const viewportRef = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState({ x: 48, y: 64, z: 1 });
  const drag = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  /** Wheel: pan; ctrl/cmd+wheel (incl. pinch) zooms toward the cursor. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCam((c) => {
        if (e.ctrlKey || e.metaKey) {
          const rect = el.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const z = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, c.z * Math.exp(-e.deltaY * 0.01))
          );
          const k = z / c.z;
          return { x: px - (px - c.x) * k, y: py - (py - c.y) * k, z };
        }
        return { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function zoomStep(dir: 1 | -1) {
    const el = viewportRef.current;
    const rect = el?.getBoundingClientRect();
    const px = (rect?.width ?? 0) / 2;
    const py = (rect?.height ?? 0) / 2;
    setCam((c) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.z + dir * 0.1));
      const k = z / c.z;
      return { x: px - (px - c.x) * k, y: py - (py - c.y) * k, z };
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return; // background only
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setCam((c) => ({
      ...c,
      x: drag.current!.camX + (e.clientX - drag.current!.startX),
      y: drag.current!.camY + (e.clientY - drag.current!.startY),
    }));
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    // A no-movement click on the background clears the selection.
    if (d && Math.abs(e.clientX - d.startX) < 4 && Math.abs(e.clientY - d.startY) < 4)
      setActiveShot(null);
  }

  async function addBlankShot() {
    try {
      const next = shots.reduce((m, s) => Math.max(m, s.sort_order), 0) + 1;
      const shot = await insertShot(projectId, {
        sort_order: next,
        title: "",
      });
      addShots([shot]);
      setActiveShot(shot.id);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function removeShotFully(id: string) {
    removeShot(id);
    await deleteShot(id);
  }

  /**
   * Insert a transition between shots i and i+1: its A/B pair is the previous
   * shot's end frame and the next shot's start frame, so a clip generated for
   * it bridges the two.
   */
  async function addTransition(i: number) {
    const prev = shots[i];
    const next = shots[i + 1];
    if (!prev?.end_asset_id || !next?.start_asset_id) return;
    try {
      const shot = await insertShot(projectId, {
        kind: "transition",
        sort_order: next.sort_order,
        title: "Transition",
        status: "accepted",
        start_asset_id: prev.end_asset_id,
        end_asset_id: next.start_asset_id,
      });
      const ordered = [...shots.slice(0, i + 1), shot, ...shots.slice(i + 1)];
      await reorderShots(ordered.map((s) => s.id));
      setShots(ordered.map((s, j) => ({ ...s, sort_order: j + 1 })));
      setActiveShot(shot.id);
      setView("fixit");
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function uploadStartFrame(file: File) {
    const shot = shots.find((s) => s.id === activeShotId);
    if (!shot) return;
    setBusy("Uploading start frame…");
    try {
      const version =
        assets.filter(
          (a) =>
            a.metadata?.shot_id === shot.id && a.metadata?.shot_role === "start"
        ).length + 1;
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "image",
        pathname: `projects/${projectId}/shots/${shot.id}/${file.name}`,
        metadata: { shot_id: shot.id, shot_role: "start", version, manual: true },
      });
      addAssets([asset]);
      const patch: Partial<Shot> = { start_asset_id: asset.id, status: "accepted" };
      patchShotLocal(shot.id, patch);
      await patchShot(shot.id, patch);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function openShot(id: string) {
    setActiveShot(id);
    setView("fixit");
  }

  const assetUrl = (id: string | null) =>
    id ? assets.find((a) => a.id === id)?.url ?? null : null;

  return (
    <section className="isolate relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border-soft">
      {/* Toolbar */}
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 border border-border bg-background p-1">
        <button
          onClick={onMakeVideo}
          disabled={!onMakeVideo || !!busy}
          className="whitespace-nowrap border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
          title="Generate video clips for finished shots"
        >
          Make me a video
        </button>
        <button
          onClick={() => uploadInput.current?.click()}
          disabled={!activeShotId || !!busy}
          className="whitespace-nowrap border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
          title={activeShotId ? "Upload a start frame for the selected shot" : "Select a shot first"}
        >
          Upload
        </button>
        <button
          onClick={addBlankShot}
          disabled={!!busy}
          className="whitespace-nowrap border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
        >
          + Add shot
        </button>
        <button
          onClick={onImagesFromScript}
          disabled={!onImagesFromScript || !!busy}
          className="whitespace-nowrap border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
          title="Have the agent plan shots from your script and generate start frames"
        >
          ✦ Images from script
        </button>
        <span className="mx-1 h-4 w-px bg-border-soft" />
        <button
          onClick={() => zoomStep(-1)}
          className="border border-border-soft px-2 py-1 font-mono text-[10px] hover:border-border"
        >
          −
        </button>
        <span className="w-12 text-center font-mono text-[10px] text-muted">
          {Math.round(cam.z * 100)}%
        </span>
        <button
          onClick={() => zoomStep(1)}
          className="border border-border-soft px-2 py-1 font-mono text-[10px] hover:border-border"
        >
          +
        </button>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      >
        {shots.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="max-w-sm text-center font-mono text-[11px] leading-relaxed text-muted">
              No shots yet. Add your script and location images in the left
              rail, then press ✦ IMAGES FROM SCRIPT — or + ADD SHOT to lay out
              frames by hand.
            </p>
          </div>
        )}
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`,
            transformOrigin: "0 0",
          }}
        >
          {shots.map((shot, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const url = assetUrl(shot.start_asset_id);
            const selected = shot.id === activeShotId;
            const statusLabel = STATUS_LABEL[shot.status];
            return (
              <div
                key={shot.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setActiveShot(shot.id)}
                onDoubleClick={() => openShot(shot.id)}
                className={`group absolute border bg-panel ${
                  shot.status === "escalated"
                    ? "border-danger"
                    : selected
                      ? "border-foreground"
                      : "border-border-soft hover:border-border"
                }`}
                style={{
                  left: col * (CARD_W + GAP),
                  top: row * (CARD_H + GAP),
                  width: CARD_W,
                  height: CARD_H,
                }}
                title={shot.title || `Shot ${i + 1}`}
              >
                {url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={url}
                    alt={shot.title || `Shot ${i + 1}`}
                    className="h-full w-full object-cover"
                    draggable={false}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center border border-dashed border-border-soft">
                    <span className="font-mono text-[10px] text-muted">
                      {statusLabel ?? "empty"}
                    </span>
                  </div>
                )}
                {/* number badge */}
                <span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center border border-border bg-background px-1 font-mono text-[10px]">
                  {shot.kind === "transition" ? "⇄" : i + 1}
                </span>
                {shot.kind === "transition" && (
                  <span className="absolute left-9 top-1.5 border border-border-soft bg-background px-1 py-px font-mono text-[9px] uppercase tracking-wider text-muted">
                    transition
                  </span>
                )}
                {/* status / revision chip */}
                {(statusLabel || shot.revision_count > 0) && url && (
                  <span
                    className={`absolute bottom-1.5 left-1.5 border bg-background px-1 py-px font-mono text-[9px] uppercase tracking-wider ${
                      shot.status === "escalated"
                        ? "border-danger text-danger"
                        : "border-border-soft text-muted"
                    }`}
                  >
                    {statusLabel ?? ""}
                    {shot.revision_count > 0 ? ` v${shot.revision_count + 1}` : ""}
                  </span>
                )}
                {shot.video_asset_id && (
                  <span className="absolute bottom-1.5 right-1.5 border border-border-soft bg-background px-1 font-mono text-[9px]">
                    ▶
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeShotFully(shot.id);
                  }}
                  className="absolute right-1.5 top-1.5 hidden border border-border-soft bg-background px-1.5 py-0.5 font-mono text-[10px] hover:border-danger hover:text-danger group-hover:block"
                  title="Delete shot"
                >
                  ×
                </button>
              </div>
            );
          })}
          {/* transition "+" between horizontally adjacent shots */}
          {shots.slice(0, -1).map((shot, i) => {
            if (i % COLS === COLS - 1) return null; // row wrap
            const next = shots[i + 1];
            const enabled = !!(shot.end_asset_id && next?.start_asset_id);
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            return (
              <button
                key={`t-${shot.id}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => addTransition(i)}
                disabled={!enabled}
                title={
                  enabled
                    ? "Add a transition clip bridging these shots (end frame → next start frame)"
                    : "Transitions need the left shot's end frame (B) and the right shot's start frame (A)"
                }
                className="absolute flex h-6 w-6 items-center justify-center border border-border-soft bg-background font-mono text-[11px] opacity-30 hover:border-border hover:opacity-100 disabled:opacity-10"
                style={{
                  left: col * (CARD_W + GAP) + CARD_W + GAP / 2 - 12,
                  top: row * (CARD_H + GAP) + CARD_H / 2 - 12,
                }}
              >
                +
              </button>
            );
          })}
        </div>
      </div>

      <input
        ref={uploadInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) uploadStartFrame(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </section>
  );
}
