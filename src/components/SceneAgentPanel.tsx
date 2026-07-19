"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import {
  useSceneAgent,
  type ScenePhase,
  type SceneAgentEvent,
} from "@/lib/scene-store";
import { MAX_AUTO_FIXES } from "@/lib/scene-agent";
import type { Shot, ShotSpec } from "@/lib/types";

const PHASE_LABEL: Record<ScenePhase, string> = {
  idle: "idle",
  planning: "planning…",
  "awaiting-approval": "plan ready — awaiting your go",
  running: "working…",
  paused: "paused — needs you",
  done: "done",
};

const EVENT_GLYPH: Record<SceneAgentEvent["kind"], string> = {
  info: "·",
  plan: "⟡",
  gen: "▦",
  verdict: "≟",
  fix: "✎",
  escalate: "!",
  error: "×",
};

type WindowMode = "docked" | "floating" | "minimized";

interface WindowState {
  mode: WindowMode;
  x: number;
  y: number;
  w: number;
  h: number;
  chipX: number;
  chipY: number;
}

const WINDOW_KEY = "al-agent-window";

function loadWindowState(): WindowState {
  const fallback: WindowState = {
    mode: "docked",
    x: 80,
    y: 80,
    w: 640,
    h: 640,
    chipX: -1,
    chipY: -1,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(WINDOW_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export default function SceneAgentPanel({
  onGenerate,
  onResume,
  onCancel,
  onReplan,
  onMakeEndFrames,
  onMakeVideos,
  onRetryShot,
  onAcceptShot,
  onApproveVersion,
  onUploadFrame,
  onPlanScene,
  onPatchProject,
}: {
  onGenerate?: (dryRun?: boolean) => void;
  onResume?: () => void;
  onCancel?: () => void;
  onReplan?: () => void;
  onMakeEndFrames?: () => void;
  onMakeVideos?: () => void;
  onRetryShot?: (shotId: string) => void;
  onAcceptShot?: (shotId: string) => void;
  onApproveVersion?: (shotId: string, assetId: string) => void;
  onUploadFrame?: (shotId: string, file: File) => void;
  onPlanScene?: () => void;
  onPatchProject?: (patch: Record<string, unknown>) => void;
}) {
  const [dryRun, setDryRun] = useState(false);
  const { project, patchProject, assets } = useWorkspace();
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadShotId = useRef<string | null>(null);
  const {
    panelOpen,
    setPanelOpen,
    phase,
    events,
    shots,
    setView,
    setActiveShot,
  } = useSceneAgent();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<WindowState>(loadWindowState);
  const drag = useRef<{
    kind: "panel" | "chip";
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(WINDOW_KEY, JSON.stringify(win));
    } catch {
      /* ignore */
    }
  }, [win]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events.length, phase]);

  const startDrag = useCallback(
    (kind: "panel" | "chip") => (e: React.PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      const rect = (
        kind === "panel" ? el.parentElement! : el
      ).getBoundingClientRect();
      drag.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        baseX: rect.left,
        baseY: rect.top,
        moved: false,
      };
    },
    []
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      d.moved = true;
      const x = Math.max(0, d.baseX + dx);
      const y = Math.max(0, d.baseY + dy);
      if (d.kind === "panel") {
        // Dragging a docked panel releases it into floating mode.
        setWin((w) => ({ ...w, mode: "floating", x, y }));
      } else {
        setWin((w) => ({ ...w, chipX: x, chipY: y }));
      }
    },
    []
  );

  const endDrag = useCallback(
    (restore?: () => void) => (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      void e;
      if (d && !d.moved && restore) restore();
    },
    []
  );

  const planned = shots.filter((s) => s.status === "planned");
  const escalated = shots.filter((s) => s.status === "escalated");
  const endFrameReady = shots.filter(
    (s) =>
      s.kind === "shot" &&
      s.start_asset_id &&
      !s.end_asset_id &&
      ["passed", "accepted"].includes(s.status)
  );
  const videoReady = shots.filter(
    (s) =>
      s.start_asset_id &&
      !s.video_asset_id &&
      (["passed", "accepted"].includes(s.status) || s.kind === "transition")
  );
  const resumable =
    phase === "paused" &&
    shots.some((s) =>
      ["approved", "generating", "judging", "fixing"].includes(s.status)
    );
  const busy = phase === "running" || phase === "planning";

  // Closed panel: keep a progress chip visible while the agent works or
  // needs the user, so closing never hides an active run.
  const showChipOnly =
    (!panelOpen && (busy || escalated.length > 0)) ||
    (panelOpen && win.mode === "minimized");

  const locationThumb = (shot: Shot) =>
    project?.location_map?.find((l) => l.asset_id === shot.location_asset_id)
      ?.url ?? null;

  function openInFixit(shotId: string) {
    // Land on this shot's own frame, not a stale/other-shot selection.
    useWorkspace.getState().select(null);
    setActiveShot(shotId);
    setView("fixit");
    setPanelOpen(false);
  }

  if (!panelOpen && !showChipOnly) return null;

  if (showChipOnly) {
    const chipStyle =
      win.chipX >= 0
        ? { left: win.chipX, top: win.chipY }
        : { right: 16, bottom: 16 };
    return (
      <button
        onPointerDown={startDrag("chip")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag(() => {
          setPanelOpen(true);
          setWin((w) => ({
            ...w,
            mode: w.mode === "minimized" ? "floating" : w.mode,
          }));
        })}
        className="fixed z-50 flex cursor-grab touch-none items-center gap-2 border border-border bg-background px-3 py-2 shadow-xl active:cursor-grabbing"
        style={chipStyle}
        title="Action scene maker — click to open, drag to move"
      >
        <span className="font-mono text-[10px] uppercase tracking-widest">
          ⟡ {PHASE_LABEL[phase]}
        </span>
        {busy && <span className="h-2 w-2 animate-pulse bg-foreground" />}
        {escalated.length > 0 && (
          <span className="border border-danger px-1 font-mono text-[9px] text-danger">
            {escalated.length}
          </span>
        )}
      </button>
    );
  }

  const frameClass =
    "z-50 flex flex-col border border-border bg-background shadow-xl";
  const frameStyle: React.CSSProperties =
    win.mode === "floating"
      ? {
          position: "fixed",
          left: win.x,
          top: win.y,
          width: win.w,
          height: win.h,
          minWidth: 360,
          minHeight: 280,
          maxWidth: "calc(100vw - 2rem)",
          maxHeight: "calc(100vh - 2rem)",
          resize: "both",
          overflow: "hidden",
        }
      : {
          position: "fixed",
          right: 16,
          bottom: 16,
          top: 64,
          width: "min(40rem, calc(100vw - 2rem))",
        };

  return (
    <aside
      className={frameClass}
      style={frameStyle}
      onMouseUp={(e) => {
        // Capture user resizes (CSS resize handle) into persisted state.
        if (win.mode !== "floating") return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (Math.abs(rect.width - win.w) > 2 || Math.abs(rect.height - win.h) > 2)
          setWin((w) => ({ ...w, w: rect.width, h: rect.height }));
      }}
    >
      {/* Header — drag to move (releases the dock) */}
      <div
        onPointerDown={startDrag("panel")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag()}
        className="flex shrink-0 cursor-grab touch-none items-center justify-between border-b border-border-soft px-3 py-2 active:cursor-grabbing"
        title="Drag to move"
      >
        <span className="font-mono text-[11px] uppercase tracking-widest">
          ⟡ Action scene maker
          <span className="ml-3 normal-case tracking-normal text-muted">
            {PHASE_LABEL[phase]}
          </span>
        </span>
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() =>
              setWin((w) => ({
                ...w,
                mode: w.mode === "docked" ? "floating" : "docked",
              }))
            }
            className="border border-border-soft px-2 py-0.5 font-mono text-[11px] hover:border-border"
            title={win.mode === "docked" ? "Release from dock" : "Dock to the right"}
          >
            {win.mode === "docked" ? "⇱" : "⇲"}
          </button>
          <button
            onClick={() => setWin((w) => ({ ...w, mode: "minimized" }))}
            className="border border-border-soft px-2 py-0.5 font-mono text-[11px] hover:border-border"
            title="Minimize to a movable chip"
          >
            –
          </button>
          <button
            onClick={() => setPanelOpen(false)}
            className="border border-border-soft px-2 py-0.5 font-mono text-[11px] hover:border-border"
            title="Close (the agent keeps working — a chip stays while it runs)"
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Intake: script + intent + plan trigger */}
        {planned.length === 0 && (phase === "idle" || phase === "done") && (
          <div className="mb-3 border border-border-soft">
            <div className="border-b border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted">
              Set up the scene
            </div>
            <div className="flex flex-col gap-2 p-2">
              <p className="font-mono text-[10px] leading-relaxed text-muted">
                1 — Give me your intent and script below. 2 — Add your art
                direction, location images (the path the action travels, in
                order), and elements in the LEFT SIDE BAR. 3 — Press ✦ PLAN
                SCENE and I&apos;ll break the script into shots.
              </p>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-muted">
                  Intent
                </label>
                <textarea
                  value={project?.intent ?? ""}
                  onChange={(e) => {
                    patchProject({ intent: e.target.value });
                    onPatchProject?.({ intent: e.target.value });
                  }}
                  placeholder="What happens in this sequence? Who, where, what motion…"
                  rows={2}
                  className="w-full border border-border-soft bg-transparent p-2 text-xs outline-none focus:border-border"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-muted">
                  Script
                </label>
                <textarea
                  value={project?.script ?? ""}
                  onChange={(e) => {
                    patchProject({ script: e.target.value });
                    onPatchProject?.({ script: e.target.value });
                  }}
                  placeholder="Paste the action sequence — I'll parse it into shots…"
                  rows={6}
                  className="w-full border border-border-soft bg-transparent p-2 text-xs outline-none focus:border-border"
                />
              </div>
              <button
                onClick={onPlanScene}
                disabled={
                  !onPlanScene ||
                  !project?.script?.trim() ||
                  !project?.location_map?.length
                }
                title={
                  !project?.script?.trim()
                    ? "Add a script first"
                    : !project?.location_map?.length
                      ? "Add at least one location image in the left side bar"
                      : "Break the script into shots across your location map"
                }
                className="w-full border border-foreground px-3 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
              >
                ✦ Plan scene
              </button>
              {!project?.location_map?.length && (
                <p className="text-center font-mono text-[9px] text-danger">
                  No location images yet — add them in the left side bar.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Plan review */}
        {planned.length > 0 && (
          <div className="mb-3 border border-border-soft">
            <div className="border-b border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted">
              The plan — {planned.length} shots
            </div>
            {planned.map((shot, i) => {
              const spec = shot.spec as Partial<ShotSpec>;
              const thumb = locationThumb(shot);
              return (
                <div
                  key={shot.id}
                  className="flex gap-2 border-b border-border-soft p-2 last:border-b-0"
                >
                  <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[10px] text-muted">
                    {i + 1}
                  </span>
                  {thumb && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={thumb}
                      alt=""
                      className="h-9 w-14 shrink-0 border border-border-soft object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs">{shot.title || "Untitled shot"}</div>
                    {spec?.description && (
                      <div className="mt-0.5 text-[10px] leading-snug text-muted">
                        {spec.description}
                      </div>
                    )}
                    {spec?.screen_direction && (
                      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted">
                        {spec.screen_direction}
                      </div>
                    )}
                    {shot.prompts?.image_a && (
                      <details className="mt-1">
                        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-muted hover:text-foreground">
                          frame A prompt
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap border border-border-soft p-1.5 font-mono text-[10px] leading-relaxed text-muted">
                          {shot.prompts.image_a}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Escalations — a light approve/upload/retry choice, never homework. */}
        {escalated.map((shot) => {
          const verdict = shot.judge?.last;
          const idx = shots.indexOf(shot) + 1;
          const versions = assets
            .filter(
              (a) =>
                a.metadata?.shot_id === shot.id &&
                a.metadata?.shot_role === "start"
            )
            .sort(
              (a, b) =>
                ((a.metadata?.version as number) ?? 0) -
                ((b.metadata?.version as number) ?? 0)
            );
          return (
            <div key={shot.id} className="mb-3 border border-danger">
              <div className="border-b border-danger px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-danger">
                Shot {idx} needs your call
              </div>
              <div className="p-2">
                {verdict?.summary && (
                  <p className="text-[11px] leading-snug">{verdict.summary}</p>
                )}
                {verdict?.checks
                  ?.filter((c) => !c.pass)
                  .map((c) => (
                    <p key={c.id} className="mt-1 font-mono text-[10px] text-muted">
                      ✗ {c.id}
                      {c.issue ? ` — ${c.issue}` : ""}
                    </p>
                  ))}
                {versions.length > 0 && (
                  <>
                    <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-muted">
                      Click a frame to approve it and keep going
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {versions.map((a) => {
                        const current = a.id === shot.start_asset_id;
                        return (
                          <button
                            key={a.id}
                            onClick={() => onApproveVersion?.(shot.id, a.id)}
                            disabled={!onApproveVersion || busy}
                            className={`relative border disabled:opacity-40 ${
                              current
                                ? "border-foreground"
                                : "border-border-soft hover:border-foreground"
                            }`}
                            title="Approve this version as the shot's start frame"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={a.url}
                              alt=""
                              className="aspect-video h-16 object-cover"
                              loading="lazy"
                            />
                            <span className="absolute bottom-0 left-0 bg-background px-1 font-mono text-[9px]">
                              v{(a.metadata?.version as number) ?? "?"}
                              {current ? " · latest" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    onClick={() => onRetryShot?.(shot.id)}
                    disabled={!onRetryShot || busy}
                    className="border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
                    title="Reset the fix budget and try again"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => {
                      uploadShotId.current = shot.id;
                      uploadRef.current?.click();
                    }}
                    disabled={!onUploadFrame || busy}
                    className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
                    title="Use your own image as this shot's start frame"
                  >
                    Upload frame
                  </button>
                  {versions.length === 0 && (
                    <button
                      onClick={() => onAcceptShot?.(shot.id)}
                      disabled={!onAcceptShot || busy}
                      className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
                      title="Keep the current frame as-is"
                    >
                      Accept anyway
                    </button>
                  )}
                  <button
                    onClick={() => openInFixit(shot.id)}
                    className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border"
                    title="Open this shot's detail view — prompts, inputs, and canvas tools"
                  >
                    Shot detail
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Live feed */}
        {events.map((e, i) => (
          <div key={i} className="mb-1 flex gap-2">
            <span
              className={`w-3 shrink-0 text-center font-mono text-[10px] ${
                e.kind === "error" || e.kind === "escalate"
                  ? "text-danger"
                  : "text-muted"
              }`}
            >
              {EVENT_GLYPH[e.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`font-mono text-[10px] leading-relaxed ${
                  e.kind === "error" ? "text-danger" : ""
                }`}
              >
                {e.text}
              </p>
              {e.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={e.imageUrl}
                  alt=""
                  className="mt-1 h-16 border border-border-soft object-cover"
                  loading="lazy"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && uploadShotId.current) onUploadFrame?.(uploadShotId.current, f);
          e.target.value = "";
        }}
      />

      {/* Footer: run controls */}
      <div className="shrink-0 border-t border-border-soft p-2">
        {busy && (
          <button
            onClick={onCancel}
            disabled={!onCancel}
            className="w-full border border-danger px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-danger hover:bg-danger hover:text-background disabled:opacity-40"
            title="Stop after the step in flight — progress is saved, Resume continues later"
          >
            Cancel run
          </button>
        )}
        {!busy && planned.length > 0 && (
          <>
            <button
              onClick={() => onGenerate?.(dryRun)}
              disabled={!onGenerate}
              className="w-full border border-foreground px-3 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
            >
              Generate {planned.length} start frame
              {planned.length > 1 ? "s" : ""}
              {dryRun ? " (dry run)" : ""}
            </button>
            <p className="mt-1 text-center font-mono text-[9px] text-muted">
              ≈ {planned.length} image generation
              {planned.length > 1 ? "s" : ""} + review passes · auto-fixes
              capped at {MAX_AUTO_FIXES} per shot
            </p>
            {process.env.NODE_ENV === "development" && (
              <label className="mt-1 flex items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                dry run — no fal credits, judge/fix loop only
              </label>
            )}
          </>
        )}
        {!busy && resumable && (
          <button
            onClick={onResume}
            disabled={!onResume}
            className="mt-1 w-full border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
          >
            Resume run
          </button>
        )}
        {!busy && videoReady.length > 0 && (
          <button
            onClick={onMakeVideos}
            disabled={!onMakeVideos}
            className="mt-1 w-full border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
            title="Render a clip for every finished shot with your selected video model — or use ▶ on a shot card for just one"
          >
            ▶ Generate {videoReady.length} video
            {videoReady.length > 1 ? "s" : ""}
          </button>
        )}
        {!busy && endFrameReady.length > 0 && (
          <button
            onClick={onMakeEndFrames}
            disabled={!onMakeEndFrames}
            className="mt-1 w-full border border-border-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted hover:border-border hover:text-foreground disabled:opacity-40"
            title="Optional — frame B is only used by start+end-frame video models (Kling, Seedance). Skip it for single-frame models like Grok Imagine."
          >
            Generate {endFrameReady.length} end frame
            {endFrameReady.length > 1 ? "s" : ""} (optional)
          </button>
        )}
        {!busy && shots.length > 0 && (
          <button
            onClick={onReplan}
            disabled={!onReplan}
            className="mt-1 w-full border border-border-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted hover:border-border hover:text-foreground disabled:opacity-40"
            title="Delete all shots and re-plan from the same intent, script, locations, and elements"
          >
            ↻ Re-plan scene from inputs
          </button>
        )}
      </div>
    </aside>
  );
}
