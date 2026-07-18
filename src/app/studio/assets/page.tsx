"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Asset, AssetType } from "@/lib/types";

type AssetWithProject = Asset & { projects: { name: string } | null };

const FILTERS: { key: AssetType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Generated images" },
  { key: "video", label: "Videos" },
  { key: "reference", label: "References" },
  { key: "art-direction", label: "Art direction" },
  { key: "canvas-shot", label: "Canvas shots" },
  { key: "drawing", label: "Drawings" },
];

export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetWithProject[]>([]);
  const [filter, setFilter] = useState<AssetType | "all">("all");
  const [viewing, setViewing] = useState<AssetWithProject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    createClient()
      .from("assets")
      .select("*, projects(name)")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setAssets((data as AssetWithProject[]) ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? assets : assets.filter((a) => a.type === filter)),
    [assets, filter]
  );

  async function deleteAsset(id: string) {
    if (!confirm("Delete this asset permanently?")) return;
    setAssets((prev) => prev.filter((a) => a.id !== id));
    setViewing(null);
    await fetch("/api/assets/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b border-border-soft px-4">
        <div className="flex items-center gap-4">
          <Link
            href="/studio"
            className="font-mono text-[11px] uppercase tracking-wider text-muted hover:text-foreground"
          >
            ← Studio
          </Link>
          <span className="font-mono text-xs tracking-[0.3em]">ASSETS</span>
        </div>
        <span className="font-mono text-[10px] text-muted">
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="flex gap-1 border-b border-border-soft px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
              filter === f.key
                ? "border-foreground bg-foreground text-background"
                : "border-border-soft text-muted hover:border-border"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {loading ? (
          <span className="font-mono text-[11px] text-muted">Loading…</span>
        ) : filtered.length === 0 ? (
          <span className="font-mono text-[11px] text-muted">
            Nothing here yet.
          </span>
        ) : (
          filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => setViewing(a)}
              className="group relative aspect-video border border-border-soft hover:border-border"
              title={a.prompt ?? a.type}
            >
              {a.type === "video" ? (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <video
                  src={a.url}
                  muted
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={a.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
              <span className="absolute bottom-0 left-0 right-0 truncate bg-background/85 px-1 py-0.5 text-left font-mono text-[9px] text-muted">
                {a.type} · {a.projects?.name ?? "—"}
              </span>
            </button>
          ))
        )}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setViewing(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-border bg-background p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-h-0 flex-1 overflow-auto">
              {viewing.type === "video" ? (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <video src={viewing.url} controls autoPlay className="w-full" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={viewing.url} alt="" className="w-full object-contain" />
              )}
            </div>
            {viewing.prompt && (
              <p className="mt-2 max-h-24 overflow-y-auto border-t border-border-soft pt-2 font-mono text-[10px] leading-relaxed text-muted">
                {viewing.prompt}
              </p>
            )}
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted">
                {viewing.type} · {viewing.model ?? "uploaded"} ·{" "}
                {viewing.projects?.name ?? "—"} ·{" "}
                {new Date(viewing.created_at).toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(viewing.url)}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                  title="Copy URL to reuse in any project"
                >
                  Copy URL
                </button>
                <a
                  href={viewing.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                >
                  Download
                </a>
                <button
                  onClick={() => deleteAsset(viewing.id)}
                  className="border border-danger px-2 py-1 font-mono text-[10px] uppercase text-danger"
                >
                  Delete
                </button>
                <button
                  onClick={() => setViewing(null)}
                  className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase hover:border-border"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
