"use client";

import { useRef } from "react";
import { useWorkspace } from "@/lib/store";
import { saveBlobAsAsset } from "@/lib/canvas";

export default function PreviewPanel({
  projectId,
  onAnnotate,
}: {
  projectId: string;
  onAnnotate: (url: string) => void;
}) {
  const {
    assets,
    selectedAssetId,
    select,
    startFrameId,
    endFrameId,
    setStartFrame,
    setEndFrame,
    addAssets,
    removeAsset,
    setBusy,
  } = useWorkspace();
  const uploadInput = useRef<HTMLInputElement>(null);

  async function uploadImage(file: File) {
    setBusy("Uploading image…");
    try {
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "image",
        pathname: `projects/${projectId}/uploads/${file.name}`,
        metadata: { source: "user-upload" },
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
    removeAsset(id);
    await fetch("/api/assets/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  const selected =
    assets.find((a) => a.id === selectedAssetId) ??
    [...assets].reverse().find((a) => a.type === "image") ??
    assets[assets.length - 1];

  const images = assets.filter((a) =>
    ["image", "canvas-shot", "drawing", "reference", "art-direction"].includes(
      a.type
    )
  );

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
            <a
              href={selected.url}
              download
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border"
            >
              Download
            </a>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-panel p-2">
        {!selected ? (
          <p className="font-mono text-[11px] text-muted">
            Nothing yet — upload a reference or generate.
          </p>
        ) : selected.type === "video" ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <video
            key={selected.id}
            src={selected.url}
            controls
            className="max-h-full max-w-full"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={selected.id}
            src={selected.url}
            alt={selected.prompt ?? "asset"}
            className="max-h-full max-w-full object-contain"
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
              title={`${a.type}${a.prompt ? ` — ${a.prompt.slice(0, 80)}` : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt=""
                className="h-full w-full cursor-pointer object-cover"
                loading="lazy"
                onClick={() => select(a.id)}
              />
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
    </section>
  );
}
