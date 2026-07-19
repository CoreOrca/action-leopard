"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import { planScene } from "@/lib/scene-agent";
import { saveBlobAsAsset } from "@/lib/canvas";
import type { Element, ElementKind, LocationMapEntry } from "@/lib/types";

const KINDS: ElementKind[] = [
  "character",
  "prop",
  "vehicle",
  "location",
  "set-dressing",
  "other",
];

export default function SidePanel({
  projectId,
  onPatchProject,
}: {
  projectId: string;
  onPatchProject: (patch: Record<string, unknown>) => void;
}) {
  const {
    project,
    patchProject,
    elements,
    setElements,
    assets,
    addAssets,
    removeAsset,
    setBusy,
    setAgentOpen,
    agentOpen,
  } = useWorkspace();
  const refInput = useRef<HTMLInputElement>(null);
  const adInput = useRef<HTMLInputElement>(null);
  const elImgInput = useRef<HTMLInputElement>(null);
  const locInput = useRef<HTMLInputElement>(null);
  const [pendingElementId, setPendingElementId] = useState<string | null>(null);

  const isScene = project?.project_type === "scene";

  function saveLocationMap(next: LocationMapEntry[]) {
    patchProject({ location_map: next });
    onPatchProject({ location_map: next });
  }

  async function uploadLocationImage(file: File) {
    if (!project) return;
    setBusy("Uploading location image…");
    try {
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "reference",
        pathname: `projects/${projectId}/locations/${file.name}`,
      });
      addAssets([asset]);
      saveLocationMap([
        ...(project.location_map ?? []),
        {
          asset_id: asset.id,
          url: asset.url,
          label: `Location ${(project.location_map?.length ?? 0) + 1}`,
        },
      ]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function moveLocation(index: number, dir: -1 | 1) {
    if (!project) return;
    const next = [...(project.location_map ?? [])];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    saveLocationMap(next);
  }

  /** Star one location as the scene overview (whole-location orientation image). */
  function toggleOverview(index: number) {
    if (!project) return;
    const next = (project.location_map ?? []).map((l, j) => ({
      ...l,
      overview: j === index ? !l.overview : false,
    }));
    saveLocationMap(next);
  }

  async function uploadReference(file: File) {
    setBusy("Uploading reference…");
    try {
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "reference",
        pathname: `projects/${projectId}/reference/${file.name}`,
      });
      addAssets([asset]);
      patchProject({ reference_image_url: asset.url });
      onPatchProject({ reference_image_url: asset.url });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function uploadArtDirectionImage(file: File) {
    setBusy("Uploading art direction image…");
    try {
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "art-direction",
        pathname: `projects/${projectId}/art-direction/${file.name}`,
      });
      addAssets([asset]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addElement() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("elements")
      .insert({
        project_id: projectId,
        user_id: user.id,
        kind: "character",
        name: "New element",
      })
      .select()
      .single();
    if (!error && data) setElements([...elements, data as Element]);
  }

  async function patchElement(id: string, patch: Partial<Element>) {
    setElements(
      elements.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
    await createClient().from("elements").update(patch).eq("id", id);
  }

  async function deleteElement(id: string) {
    setElements(elements.filter((e) => e.id !== id));
    await createClient().from("elements").delete().eq("id", id);
  }

  async function uploadElementImage(file: File) {
    if (!pendingElementId) return;
    setBusy("Uploading element image…");
    try {
      const asset = await saveBlobAsAsset(file, {
        projectId,
        type: "element",
        pathname: `projects/${projectId}/elements/${file.name}`,
        metadata: { element_id: pendingElementId },
      });
      addAssets([asset]);
      await patchElement(pendingElementId, { image_url: asset.url });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPendingElementId(null);
      setBusy(null);
    }
  }

  if (!project) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border-soft p-3">
      {/* Intent */}
      <div>
        <h3 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          Intent
        </h3>
        <textarea
          value={project.intent}
          onChange={(e) => {
            patchProject({ intent: e.target.value });
            onPatchProject({ intent: e.target.value });
          }}
          placeholder="What happens in this sequence? Who, where, what motion…"
          rows={4}
          className="w-full border border-border-soft bg-transparent p-2 text-xs outline-none focus:border-border"
        />
        <button
          onClick={() => {
            if (isScene) {
              const s = useSceneAgent.getState();
              s.setPanelOpen(!s.panelOpen);
            } else setAgentOpen(!agentOpen);
          }}
          className="mt-1 w-full border border-foreground px-2 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-foreground hover:text-background"
        >
          ⟡ {!isScene && agentOpen ? "Close agent" : "Agent"}
        </button>
      </div>

      {/* Script (scene projects) */}
      {isScene && (
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">
            Script
          </h3>
          <textarea
            value={project.script ?? ""}
            onChange={(e) => {
              patchProject({ script: e.target.value });
              onPatchProject({ script: e.target.value });
            }}
            placeholder="Paste the action sequence — the agent parses it into shots…"
            rows={8}
            className="w-full border border-border-soft bg-transparent p-2 text-xs outline-none focus:border-border"
          />
          <button
            onClick={() => planScene()}
            className="mt-1 w-full border border-foreground px-2 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-foreground hover:text-background"
            title="Have the agent parse the script into shots across your location map"
          >
            ✦ Plan scene
          </button>
        </div>
      )}

      {/* Location map (scene) vs single reference image (shot) */}
      {isScene ? (
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">
            Location map — path in order
          </h3>
          <div className="flex flex-col gap-1">
            {(project.location_map ?? []).map((loc, i) => (
              <div
                key={loc.asset_id}
                className="group flex items-center gap-2 border border-border-soft p-1"
              >
                <span className="w-4 text-center font-mono text-[10px] text-muted">
                  {i + 1}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={loc.url}
                  alt={loc.label}
                  className="h-10 w-16 border border-border-soft object-cover"
                  loading="lazy"
                />
                <input
                  value={loc.label}
                  onChange={(e) => {
                    const next = [...project.location_map];
                    next[i] = { ...next[i], label: e.target.value };
                    saveLocationMap(next);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"
                />
                <button
                  onClick={() => toggleOverview(i)}
                  className={`px-0.5 font-mono text-[11px] ${
                    loc.overview
                      ? "text-foreground"
                      : "text-muted opacity-0 hover:opacity-100 group-hover:opacity-60"
                  }`}
                  title={
                    loc.overview
                      ? "Scene overview — attached to every shot for orientation and backgrounds"
                      : "Star as scene overview (the image showing the whole location)"
                  }
                >
                  {loc.overview ? "★" : "☆"}
                </button>
                <div className="hidden items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={() => moveLocation(i, -1)}
                    disabled={i === 0}
                    className="border border-border-soft px-1 font-mono text-[9px] hover:border-border disabled:opacity-30"
                    title="Earlier in the path"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveLocation(i, 1)}
                    disabled={i === project.location_map.length - 1}
                    className="border border-border-soft px-1 font-mono text-[9px] hover:border-border disabled:opacity-30"
                    title="Later in the path"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() =>
                      saveLocationMap(
                        project.location_map.filter((_, j) => j !== i)
                      )
                    }
                    className="border border-border-soft px-1 font-mono text-[9px] text-muted hover:border-danger hover:text-danger"
                    title="Remove from path"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
          {(project.location_map?.length ?? 0) > 1 &&
            !project.location_map.some((l) => l.overview) && (
              <p className="mt-1 font-mono text-[9px] text-muted">
                ☆ star the image that shows the whole location — it grounds
                every shot&apos;s backdrop
              </p>
            )}
          <button
            onClick={() => locInput.current?.click()}
            className="mt-1 w-full border border-border px-2 py-2 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background"
          >
            + Location image
          </button>
          <input
            ref={locInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) uploadLocationImage(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">
            Reference image (location)
          </h3>
          {project.reference_image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={project.reference_image_url}
              alt="reference"
              className="mb-1 w-full border border-border-soft"
            />
          ) : null}
          <button
            onClick={() => refInput.current?.click()}
            className="w-full border border-border px-2 py-2 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background"
          >
            {project.reference_image_url ? "Replace" : "Upload"} reference
          </button>
          <input
            ref={refInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) =>
              e.target.files?.[0] && uploadReference(e.target.files[0])
            }
          />
        </div>
      )}

      {/* Art direction */}
      <div>
        <h3 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          Art direction
        </h3>
        <textarea
          value={project.art_direction}
          onChange={(e) => {
            patchProject({ art_direction: e.target.value });
            onPatchProject({ art_direction: e.target.value });
          }}
          placeholder="Color grade, film stock, lensing, texture, era, mood…"
          rows={4}
          className="w-full border border-border-soft bg-transparent p-2 text-xs outline-none focus:border-border"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {assets
            .filter((a) => a.type === "art-direction")
            .map((a) => (
              <div
                key={a.id}
                className="group relative h-12 w-12 border border-border-soft"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <button
                  onClick={async () => {
                    removeAsset(a.id);
                    await fetch("/api/assets/delete", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: a.id }),
                    });
                  }}
                  className="absolute right-0 top-0 hidden bg-background/90 px-1 font-mono text-[10px] text-danger group-hover:block"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
        </div>
        <button
          onClick={() => adInput.current?.click()}
          className="mt-1 w-full border border-border-soft px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider hover:border-border"
        >
          + Art direction image
        </button>
        <input
          ref={adInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) =>
            e.target.files?.[0] && uploadArtDirectionImage(e.target.files[0])
          }
        />
      </div>

      {/* Elements */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Elements
          </h3>
          <button
            onClick={addElement}
            className="border border-border-soft px-2 py-0.5 font-mono text-[10px] hover:border-border"
          >
            +
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {elements.map((el) => (
            <div key={el.id} className="border border-border-soft p-2">
              <div className="flex items-center gap-2">
                {el.image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={el.image_url}
                    alt={el.name}
                    className="h-10 w-10 border border-border-soft object-cover"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setPendingElementId(el.id);
                      elImgInput.current?.click();
                    }}
                    className="h-10 w-10 border border-dashed border-border-soft font-mono text-[9px] text-muted hover:border-border"
                  >
                    img
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <input
                    value={el.name}
                    onChange={(e) =>
                      patchElement(el.id, { name: e.target.value })
                    }
                    className="w-full bg-transparent text-xs outline-none"
                  />
                  <select
                    value={el.kind}
                    onChange={(e) =>
                      patchElement(el.id, {
                        kind: e.target.value as ElementKind,
                      })
                    }
                    className="mt-0.5 w-full border border-border-soft bg-background font-mono text-[9px] uppercase outline-none"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => deleteElement(el.id)}
                  className="font-mono text-[10px] text-muted hover:text-danger"
                  title="Delete element"
                >
                  ×
                </button>
              </div>
              <input
                value={el.notes}
                onChange={(e) => patchElement(el.id, { notes: e.target.value })}
                placeholder="notes (wardrobe, model, behavior…)"
                className="mt-1 w-full border-t border-border-soft bg-transparent pt-1 text-[10px] outline-none placeholder:text-muted"
              />
            </div>
          ))}
        </div>
        <input
          ref={elImgInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) =>
            e.target.files?.[0] && uploadElementImage(e.target.files[0])
          }
        />
      </div>
    </aside>
  );
}
