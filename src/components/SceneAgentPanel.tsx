"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent, type ScenePhase, type SceneAgentEvent } from "@/lib/scene-store";
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

export default function SceneAgentPanel({
  onGenerate,
  onResume,
  onRetryShot,
  onAcceptShot,
}: {
  onGenerate?: (dryRun?: boolean) => void;
  onResume?: () => void;
  onRetryShot?: (shotId: string) => void;
  onAcceptShot?: (shotId: string) => void;
}) {
  const [dryRun, setDryRun] = useState(false);
  const { project } = useWorkspace();
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events.length, phase]);

  if (!panelOpen) return null;

  const planned = shots.filter((s) => s.status === "planned");
  const escalated = shots.filter((s) => s.status === "escalated");
  const resumable =
    phase === "paused" &&
    shots.some((s) =>
      ["approved", "generating", "judging", "fixing"].includes(s.status)
    );

  const locationThumb = (shot: Shot) =>
    project?.location_map?.find((l) => l.asset_id === shot.location_asset_id)
      ?.url ?? null;

  function openInFixit(shotId: string) {
    setActiveShot(shotId);
    setView("fixit");
    setPanelOpen(false);
  }

  return (
    <aside className="fixed bottom-4 right-4 top-16 z-50 flex w-[min(40rem,calc(100vw-2rem))] flex-col border border-border bg-background shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-widest">
          ⟡ Action scene maker
          <span className="ml-3 normal-case tracking-normal text-muted">
            {PHASE_LABEL[phase]}
          </span>
        </span>
        <button
          onClick={() => setPanelOpen(false)}
          className="border border-border-soft px-2 py-0.5 font-mono text-[11px] hover:border-border"
          title="Close (the agent keeps working)"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
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

        {/* Escalations */}
        {escalated.map((shot) => {
          const verdict = shot.judge?.last;
          const idx = shots.indexOf(shot) + 1;
          return (
            <div key={shot.id} className="mb-3 border border-danger">
              <div className="border-b border-danger px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-danger">
                Shot {idx} needs you — {MAXED_LABEL}
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
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => onRetryShot?.(shot.id)}
                    disabled={!onRetryShot}
                    className="border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
                    title="Reset the fix budget and try again"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => onAcceptShot?.(shot.id)}
                    disabled={!onAcceptShot}
                    className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
                    title="Keep the current frame as-is"
                  >
                    Accept anyway
                  </button>
                  <button
                    onClick={() => openInFixit(shot.id)}
                    className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border"
                    title="Open this shot in the manual fix-it view"
                  >
                    Open in fix-it
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
        {events.length === 0 && planned.length === 0 && escalated.length === 0 && (
          <p className="font-mono text-[10px] leading-relaxed text-muted">
            Press ✦ IMAGES FROM SCRIPT on the shots canvas to have the agent
            plan the sequence from your script and location map.
          </p>
        )}
      </div>

      {/* Footer: approval gate / resume */}
      {(planned.length > 0 || resumable) && (
        <div className="border-t border-border-soft p-2">
          {planned.length > 0 && (
            <button
              onClick={() => onGenerate?.(dryRun)}
              disabled={!onGenerate || phase === "running"}
              className="w-full border border-foreground px-3 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
            >
              Generate {planned.length} start frame
              {planned.length > 1 ? "s" : ""}
              {dryRun ? " (dry run)" : ""}
            </button>
          )}
          {planned.length > 0 && (
            <p className="mt-1 text-center font-mono text-[9px] text-muted">
              ≈ {planned.length} image generation
              {planned.length > 1 ? "s" : ""} + review passes · auto-fixes capped
              at {MAX_AUTO_FIXES} per shot
            </p>
          )}
          {planned.length > 0 && process.env.NODE_ENV === "development" && (
            <label className="mt-1 flex items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              dry run — no fal credits, judge/fix loop only
            </label>
          )}
          {resumable && (
            <button
              onClick={onResume}
              disabled={!onResume}
              className="mt-1 w-full border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
            >
              Resume run
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

const MAXED_LABEL = "auto-fixes exhausted";
