"use client";

import { useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { useShotScope } from "@/lib/shot-scope";
import { saveBlobAsAsset } from "@/lib/canvas";
import { assetDragProps, downloadAsset } from "@/lib/download";
import VideoPlayer from "./VideoPlayer";

export default function PreviewPanel({
  projectId,
  onAnnotate,
}: {
  projectId: string;
  onAnnotate: (url: string) => void;
}) {
  const { assets, select, addAssets, removeAsset, setBusy } = useWorkspace();
  const {
    shot,
    startFrameId,
    endFrameId,
    setStartFrame,
    setEndFrame,
    filterAssets,
    previewAsset,
  } = useShotScope();
  const uploadInput = useRef<HTMLInputElement>(null);
  /** Full-size player for the previewed video. */
  const [enlarged, setEnlarged] = useState<string | null>(null);

  async function uploadImage(file: File) {
    setBusy("Uploading image…");
    try {
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "image",
        pathname: `projects/${projectId}/uploads/${file.name}`,
        metadata: {
          source: "user-upload",
          ...(shot ? { shot_id: shot.id } : {}),
        },
      });
      addAssets([asset]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteAsset(id: string) {
    if (!confirm("Delete this asset?")) return;
    const url = assets.find((a) => a.id === id)?.url;
    removeAsset(id);
    // Mirror the server's dangling-reference cleanup in local state.
    if (url) {
      const ws = useWorkspace.getState();
      ws.setElements(
        ws.elements.map((el) =>
          el.image_url === url ? { ...el, image_url: null } : el
        )
      );
      if (ws.project?.location_map?.some((l) => l.url === url))
        ws.patchProject({
          location_map: ws.project.location_map.filter((l) => l.url !== url),
        });
      if (ws.project?.reference_image_url === url)
        ws.patchProject({ reference_image_url: null });
    }
    await fetch("/api/assets/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  const images = filterAssets(assets);
  // Selection + scoped fallbacks resolved in useShotScope, shared with the
  // canvas tools so ✦ Scene targets exactly what's showing here.
  const selected = previewAsset ?? undefined;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-border-soft">
      <div className="flex items-center justify-between border-b border-border-soft px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Preview — framed shot / assets
        </span>
        {selected && (
          <div className="flex gap-1">
            {selected.type !== "video" && (
              <>
                <button
                  onClick={() =>
                    setStartFrame(
                      startFrameId === selected.id ? null : selected.id
                    )
                  }
                  className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                    startFrameId === selected.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border-soft hover:border-border"
                  }`}
                >
                  Start frame
                </button>
                <button
                  onClick={() =>
                    setEndFrame(endFrameId === selected.id ? null : selected.id)
                  }
                  className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                    endFrameId === selected.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border-soft hover:border-border"
                  }`}
                >
                  End frame
                </button>
                <button
                  onClick={() => onAnnotate(selected.url)}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border"
                  title="Place on canvas and draw over it"
                >
                  Annotate
                </button>
              </>
            )}
            {selected.type === "video" && (
              <button
                onClick={() => setEnlarged(selected.url)}
                className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border"
                title="Watch full size"
              >
                ⛶ Enlarge
              </button>
            )}
            <button
              onClick={() => downloadAsset(selected.url)}
              className="inline-flex items-center border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border"
              title="Save to disk (images can also be dragged straight to your desktop)"
            >
              Download
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-panel p-2">
        {!selected ? (
          <p className="font-mono text-[11px] text-muted">
            Nothing yet — upload a reference or generate.
          </p>
        ) : selected.type === "video" ? (
          <VideoPlayer
            key={selected.id}
            src={selected.url}
            className="flex h-full w-full flex-col"
            videoClassName="min-h-0 w-full flex-1"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={selected.id}
            src={selected.url}
            alt={selected.prompt ?? "asset"}
            className="max-h-full max-w-full object-contain"
            {...assetDragProps(selected)}
          />
        )}
      </div>

      <div className="flex h-16 min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-t border-border-soft px-1">
        <button
          onClick={() => uploadInput.current?.click()}
          className="flex h-12 w-10 shrink-0 items-center justify-center border border-dashed border-border-soft font-mono text-sm text-muted hover:border-border hover:text-foreground"
          title="Upload an outside image (usable as start/end frame)"
        >
          +
        </button>
        <input
          ref={uploadInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) uploadImage(e.target.files[0]);
            e.target.value = "";
          }}
        />
        {images.length === 0 ? (
          <span className="px-2 font-mono text-[10px] text-muted">
            image palette — empty
          </span>
        ) : (
          images.map((a) => (
            <div
              key={a.id}
              className={`group relative h-12 w-16 shrink-0 border ${
                selected?.id === a.id
                  ? "border-foreground"
                  : "border-border-soft hover:border-border"
              }`}
              title={`${a.type}${
                typeof a.metadata?.version === "number"
                  ? ` · v${a.metadata.version}`
                  : ""
              }${a.prompt ? ` — ${a.prompt.slice(0, 80)}` : ""}`}
            >
              {a.type === "video" ? (
                <div
                  className="relative h-full w-full cursor-pointer"
                  onClick={() => select(a.id)}
                >
                  {a.thumbnail_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={a.thumbnail_url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    /* eslint-disable-next-line jsx-a11y/media-has-caption */
                    <video
                      src={`${a.url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="pointer-events-none h-full w-full object-cover"
                    />
                  )}
                  <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background/80 px-1 font-mono text-[10px]">
                    ▶
                  </span>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={a.url}
                  alt=""
                  className="h-full w-full cursor-pointer object-cover"
                  loading="lazy"
                  onClick={() => select(a.id)}
                  {...assetDragProps(a)}
                />
              )}
              {(startFrameId === a.id || endFrameId === a.id) && (
                <span className="absolute left-0 top-0 flex">
                  {startFrameId === a.id && (
                    <span className="bg-foreground px-1 font-mono text-[8px] text-background">
                      A
                    </span>
                  )}
                  {endFrameId === a.id && (
                    <span className="bg-foreground px-1 font-mono text-[8px] text-background">
                      B
                    </span>
                  )}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAsset(a.id);
                }}
                className="absolute right-0 top-0 hidden bg-background/90 px-1 font-mono text-[10px] text-danger group-hover:block"
                title="Delete asset"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-black/85"
          onClick={() => setEnlarged(null)}
        >
          <div
            className="w-full max-w-5xl border border-border bg-background p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <VideoPlayer src={enlarged} autoPlay />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => setEnlarged(null)}
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
