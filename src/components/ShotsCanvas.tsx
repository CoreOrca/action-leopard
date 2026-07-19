"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import { insertShot, deleteShot, reorderShots } from "@/lib/shots";
import { uploadShotStartFrame, acceptShot, makeVideos } from "@/lib/scene-agent";
import { desktopDragProps, downloadAsset } from "@/lib/download";
import type { Shot } from "@/lib/types";

const COLS = 4;
const CARD_W = 320;
const CARD_H = 180; // 16:9
const GAP = 36;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

const STATUS_LABEL: Partial<Record<Shot["status"], string>> = {
  planned: "planned",
  generating: "generating…",
  judging: "judging…",
  fixing: "fixing…",
  escalated: "needs you",
  accepted: "accepted",
};

export default function ShotsCanvas({
  projectId,
  onMakeVideo,
}: {
  projectId: string;
  onMakeVideo?: () => void;
}) {
  const { assets, setBusy, busy } = useWorkspace();
  const {
    shots,
    activeShotId,
    setActiveShot,
    view,
    setView,
    setShots,
    addShots,
    removeShot,
  } = useSceneAgent();

  const viewportRef = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  /** The toolbar renders into the centered slot of the scene tab row. */
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarSlot(document.getElementById("scene-toolbar-slot"));
  }, []);
  const [cam, setCam] = useState({ x: 48, y: 64, z: 1 });
  /** Full-size player for a shot's clip. */
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(
    null
  );
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
      await uploadShotStartFrame(projectId, shot.id, file);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function openShot(id: string) {
    // Clear any stale preview selection so shot detail opens on THIS shot's
    // frame, not whatever was last selected or generated elsewhere.
    useWorkspace.getState().select(null);
    setActiveShot(id);
    setView("fixit");
  }

  const assetUrl = (id: string | null) =>
    id ? assets.find((a) => a.id === id)?.url ?? null : null;

  const toolbar = (
    <div className="flex items-center gap-1">
        <button
          onClick={() => useSceneAgent.getState().setPanelOpen(true)}
          disabled={!!busy}
          className="whitespace-nowrap border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
          title="Open the Action scene maker window"
        >
          Action scene maker
        </button>
        <button
          onClick={onMakeVideo}
          disabled={!onMakeVideo || !!busy}
          className="whitespace-nowrap border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
          title="Generate video clips for every finished shot (or use ▶ on a card for just one)"
        >
          ▶ Make videos
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
  );

  return (
    <section className="isolate relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border-soft">
      {toolbarSlot && view === "shots" && createPortal(toolbar, toolbarSlot)}

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
              No shots yet. Open the ⟡ ACTION SCENE MAKER (Agent button, left
              rail), give it your script and intent, and press ✦ PLAN SCENE —
              or + ADD SHOT to lay out frames by hand.
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
            const videoUrl = assetUrl(shot.video_asset_id);
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
                    loading="lazy"
                    {...desktopDragProps(url, `shot-${i + 1}.png`)}
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
                {/* Clip exists: an obvious centered play control → full-size player */}
                {videoUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlaying({
                        url: videoUrl,
                        title: shot.title || `Shot ${i + 1}`,
                      });
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-border bg-background/85 font-mono text-base shadow-sm hover:bg-foreground hover:text-background"
                    title="Play this shot's clip full size"
                  >
                    ▶
                  </button>
                )}
                <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                  {shot.status === "escalated" && url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        acceptShot(shot.id);
                      }}
                      disabled={!!busy}
                      className="border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] hover:bg-foreground hover:text-background disabled:opacity-40"
                      title="Approve this frame — clears needs-you"
                    >
                      ✓
                    </button>
                  )}
                  {!!shot.start_asset_id &&
                    !shot.video_asset_id &&
                    (["passed", "accepted"].includes(shot.status) ||
                      shot.kind === "transition") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          makeVideos({ shotIds: [shot.id] });
                        }}
                        disabled={!!busy}
                        className="border border-border-soft bg-background px-1.5 py-0.5 font-mono text-[10px] hover:border-border disabled:opacity-40"
                        title="Generate this shot's video clip"
                      >
                        ▶
                      </button>
                    )}
                  {url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadAsset(url, `shot-${i + 1}.png`);
                      }}
                      className="border border-border-soft bg-background px-1.5 py-0.5 font-mono text-[10px] hover:border-border"
                      title="Download this frame (or drag the image to your desktop)"
                    >
                      ⤓
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeShotFully(shot.id);
                    }}
                    className="border border-border-soft bg-background px-1.5 py-0.5 font-mono text-[10px] hover:border-danger hover:text-danger"
                    title="Delete shot"
                  >
                    ×
                  </button>
                </div>
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

      {playing && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-black/85"
          onClick={() => setPlaying(null)}
        >
          <div
            className="w-full max-w-5xl border border-border bg-background p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={playing.url}
              controls
              autoPlay
              className="max-h-[80vh] w-full"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="truncate font-mono text-[10px] text-muted">
                {playing.title}
              </span>
              <button
                onClick={() => setPlaying(null)}
                className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
