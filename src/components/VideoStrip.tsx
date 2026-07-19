"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import type { Asset } from "@/lib/types";

export default function VideoStrip() {
  const { project, assets, setAssets, select } = useWorkspace();
  const [playing, setPlaying] = useState<Asset | null>(null);
  /** Sequence player: index into `videos`, advancing as each clip ends. */
  const [seqIndex, setSeqIndex] = useState<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const videos = assets
    .filter((a) => a.type === "video")
    .sort((a, b) => a.sort_order - b.sort_order);

  async function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ordered = [...videos];
    const from = ordered.findIndex((v) => v.id === dragId);
    const to = ordered.findIndex((v) => v.id === targetId);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);

    const supabase = createClient();
    const updated = ordered.map((v, i) => ({ ...v, sort_order: i + 1 }));
    setAssets([
      ...assets.filter((a) => a.type !== "video"),
      ...updated,
    ]);
    await Promise.all(
      updated.map((v) =>
        supabase.from("assets").update({ sort_order: v.sort_order }).eq("id", v.id)
      )
    );
    setDragId(null);
  }

  async function deleteVideo(id: string) {
    if (!confirm("Remove this clip?")) return;
    setAssets(assets.filter((a) => a.id !== id));
    await createClient().from("assets").delete().eq("id", id);
  }

  /** Scene projects: double-click scopes shot detail to the clip's shot. */
  function onItemDoubleClick(v: Asset) {
    if (project?.project_type === "scene") {
      const scene = useSceneAgent.getState();
      const shot = scene.shots.find((s) => s.video_asset_id === v.id);
      if (shot) {
        scene.setActiveShot(shot.id);
        select(v.id);
        return;
      }
    }
    setPlaying(v);
  }

  return (
    <section className="border border-border-soft">
      <div className="flex items-center justify-between border-b border-border-soft px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Sequence — {videos.length} clip{videos.length === 1 ? "" : "s"} (drag
          to reorder)
        </span>
        {videos.length > 0 && (
          <button
            onClick={() => setSeqIndex(0)}
            className="border border-border-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:border-border"
            title="Play the whole sequence full size, clip after clip"
          >
            ▶ Play all
          </button>
        )}
      </div>
      <div className="flex h-24 items-center gap-2 overflow-x-auto p-2">
        {videos.length === 0 ? (
          <span className="font-mono text-[10px] text-muted">
            Generated clips land here, in order.
          </span>
        ) : (
          videos.map((v, i) => (
            <div
              key={v.id}
              draggable
              onDragStart={() => setDragId(v.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => reorder(v.id)}
              className="group relative h-20 w-32 shrink-0 cursor-grab border border-border-soft hover:border-border"
              onClick={() => select(v.id)}
              onDoubleClick={() => onItemDoubleClick(v)}
              title={
                project?.project_type === "scene"
                  ? "Click: view in preview · double-click: open its shot"
                  : "Click: view in preview · double-click: open player"
              }
            >
              {v.thumbnail_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={v.thumbnail_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <video
                  src={`${v.url}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              )}
              <span className="absolute bottom-0 left-0 bg-background/80 px-1 font-mono text-[9px]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteVideo(v.id);
                }}
                className="absolute right-0 top-0 hidden bg-background/80 px-1.5 font-mono text-[10px] text-danger group-hover:block"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {seqIndex !== null && videos[seqIndex] && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-black/85"
          onClick={() => setSeqIndex(null)}
        >
          <div
            className="w-full max-w-5xl border border-border bg-background p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              key={videos[seqIndex].id}
              src={videos[seqIndex].url}
              controls
              autoPlay
              onEnded={() =>
                setSeqIndex((i) =>
                  i !== null && i + 1 < videos.length ? i + 1 : null
                )
              }
              className="max-h-[80vh] w-full"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted">
                clip {seqIndex + 1} / {videos.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setSeqIndex((i) => Math.max(0, (i ?? 0) - 1))}
                  disabled={seqIndex === 0}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() =>
                    setSeqIndex((i) =>
                      i !== null && i + 1 < videos.length ? i + 1 : i
                    )
                  }
                  disabled={seqIndex + 1 >= videos.length}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border disabled:opacity-40"
                >
                  Next →
                </button>
                <button
                  onClick={() => setSeqIndex(null)}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {playing && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-black/85"
          onClick={() => setPlaying(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-4xl border border-border bg-background p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={playing.url} controls autoPlay className="w-full" />
            <div className="mt-2 flex items-center justify-between">
              <span className="max-w-[70%] truncate font-mono text-[10px] text-muted">
                {playing.model} · {playing.prompt?.slice(0, 120)}
              </span>
              <div className="flex gap-2">
                <a
                  href={playing.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                >
                  Download
                </a>
                <button
                  onClick={() => setPlaying(null)}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
