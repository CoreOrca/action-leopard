"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { useShotScope } from "@/lib/shot-scope";
import { shotGenerationInputs } from "@/lib/scene-agent";
import { getImageModel, getVideoModel } from "@/lib/models";
import { ASSET_DRAG_MIME } from "@/lib/download";

type PromptTab = "image_a" | "image_b" | "video";

const TAB_LABEL: Record<PromptTab, string> = {
  image_a: "Frame A",
  image_b: "Frame B",
  video: "Video",
};

const TAB_MODE: Record<PromptTab, "image-a" | "image-b" | "video"> = {
  image_a: "image-a",
  image_b: "image-b",
  video: "video",
};

interface InputChip {
  key: string;
  url: string;
  role: string;
}

export default function PromptBar({
  projectId,
  onPatchProject,
}: {
  projectId: string;
  onPatchProject: (patch: Record<string, unknown>) => void;
}) {
  const {
    project,
    elements,
    assets,
    addAssets,
    busy,
    setBusy,
  } = useWorkspace();
  const scope = useShotScope(onPatchProject);
  const [seconds, setSeconds] = useState(5);
  const [tab, setTab] = useState<PromptTab>("image_a");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** Images dragged in from the preview rail — extra generation inputs. */
  const [extras, setExtras] = useState<InputChip[]>([]);
  const [dropActive, setDropActive] = useState(false);

  // Dragged-in and removed inputs are per-shot working aids — clear both on
  // scope change (removal keys like "location" are shared across shots, so a
  // stale set would silently drop inputs on every other shot).
  const scopedShotId = scope.shot?.id ?? null;
  useEffect(() => {
    setExtras([]);
    setExcluded(new Set());
  }, [scopedShotId]);

  const startFrame = assets.find((a) => a.id === scope.startFrameId);
  const endFrame = assets.find((a) => a.id === scope.endFrameId);
  const latestCanvasShot = [...assets]
    .reverse()
    .find((a) => a.type === "canvas-shot");
  // Element images are stored as art-direction assets tagged with element_id —
  // they are NOT art direction and must never be labeled as such.
  const artDirectionImages = assets
    .filter((a) => a.type === "art-direction" && !a.metadata?.element_id)
    .slice(0, 3);
  const videoModel = getVideoModel(project?.video_model ?? "");
  const imageModel = getImageModel(project?.image_model ?? "");

  /** Candidate input images for the active tab; user can exclude any via chips. */
  const candidates: InputChip[] = useMemo(() => {
    const list: InputChip[] = [];
    if (tab === "video") {
      if (startFrame)
        list.push({ key: "start", url: startFrame.url, role: "start frame (A)" });
      if (endFrame)
        list.push({ key: "end", url: endFrame.url, role: "end frame (B)" });
      return list;
    }
    if (tab === "image_b") {
      if (startFrame)
        list.push({ key: "frame-a", url: startFrame.url, role: "frame A to edit" });
    } else if (startFrame) {
      list.push({ key: "frame-a", url: startFrame.url, role: "frame A (start)" });
    }
    if (scope.shot && project) {
      // Scene shot: the exact generator inputs the agent loop uses, with
      // specific labels — which location, which elements, which references.
      const loc =
        project.location_map?.find(
          (l) => l.asset_id === scope.shot!.location_asset_id
        ) ?? project.location_map?.[0];
      let ad = 0;
      for (const c of shotGenerationInputs(project, scope.shot)) {
        if (c.key === "location") {
          list.push({
            key: c.key,
            url: c.url,
            role: loc?.label || "location",
          });
        } else if (c.key === "location-overview") {
          list.push({
            key: c.key,
            url: c.url,
            role: "scene overview (orientation)",
          });
        } else if (c.key === "prev-shot-frame") {
          list.push({
            key: c.key,
            url: c.url,
            role: "prev shot frame (continuity)",
          });
        } else if (c.key === "art-direction") {
          ad += 1;
          list.push({
            key: `art-direction-${ad}`,
            url: c.url,
            role: `art direction ${ad} (style only)`,
          });
        } else if (c.key.startsWith("element:")) {
          const name = c.key.slice("element:".length);
          const el = elements.find((e) => e.name === name);
          list.push({
            key: c.key,
            url: c.url,
            role: `element — ${el ? `${el.kind}: ${el.name}` : name}`,
          });
        } else {
          list.push(c);
        }
      }
      if (latestCanvasShot)
        list.push({
          key: "canvas",
          url: latestCanvasShot.url,
          role: "canvas blocking diagram (positions only)",
        });
      return list;
    }
    // Unscoped: every input labeled as what it actually is.
    if (project?.project_type === "scene" && project.location_map?.length) {
      project.location_map.forEach((l, i) =>
        list.push({
          key: `loc-${l.asset_id}`,
          url: l.url,
          role: l.label || `Location ${i + 1}`,
        })
      );
    } else if (scope.referenceUrl) {
      list.push({
        key: "reference",
        url: scope.referenceUrl,
        role: "location reference",
      });
    }
    elements.forEach((el) => {
      if (el.image_url)
        list.push({
          key: `element:${el.name}`,
          url: el.image_url,
          role: `element — ${el.kind}: ${el.name}`,
        });
    });
    if (latestCanvasShot)
      list.push({
        key: "canvas",
        url: latestCanvasShot.url,
        role: "canvas blocking diagram (positions only)",
      });
    artDirectionImages.forEach((a, i) =>
      list.push({
        key: `ad-${a.id}`,
        url: a.url,
        role: `art direction ${i + 1} (style only)`,
      })
    );
    return list;
  }, [tab, startFrame, endFrame, scope.shot, project, elements, scope.referenceUrl, latestCanvasShot, artDirectionImages]);

  // Video generation takes only start/end frames — dragged-in images apply to
  // the image tabs.
  const allChips = tab === "video" ? candidates : [...candidates, ...extras];
  const activeInputs = allChips.filter((c) => !excluded.has(c.key));
  // Removed chips leave the rail entirely; ↺ (or dragging the image back)
  // restores them.
  const visibleCandidates = candidates.filter((c) => !excluded.has(c.key));
  const removedCandidates = candidates.filter((c) => excluded.has(c.key));

  function handleAssetDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw || tab === "video") return;
    e.preventDefault();
    setDropActive(false);
    try {
      const a = JSON.parse(raw) as { id: string; url: string; type: string };
      if (a.type === "video") return;
      // Already a known input: bring it back if it was removed, else no-op —
      // a drop must never silently vanish.
      const match = candidates.find((c) => c.url === a.url);
      if (match) {
        setExcluded((prev) => {
          if (!prev.has(match.key)) return prev;
          const next = new Set(prev);
          next.delete(match.key);
          return next;
        });
        return;
      }
      setExtras((prev) => {
        if (prev.some((c) => c.url === a.url)) return prev;
        const role =
          a.type === "canvas-shot"
            ? "canvas shot (added)"
            : a.type === "drawing"
              ? "annotated image (added)"
              : "added reference";
        return [...prev, { key: `extra-${a.id}`, url: a.url, role }];
      });
    } catch {
      // not our payload — ignore
    }
  }

  if (!project) return null;

  const promptText = scope.prompts?.[tab] ?? "";

  function setPromptText(text: string) {
    if (!project) return;
    scope.setPrompts({ ...scope.prompts, [tab]: text });
  }

  async function writePrompt() {
    if (!project) return;
    setBusy(`Grok is writing the ${TAB_LABEL[tab]} prompt…`);
    try {
      const res = await fetch("/api/prompt/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: TAB_MODE[tab],
          intent: scope.intent,
          artDirection: project.art_direction,
          elements: elements.map((e) => ({
            kind: e.kind,
            name: e.name,
            notes: e.notes,
          })),
          imageUrls: activeInputs.map((i) => ({ url: i.url, role: i.role })),
          frameAPrompt: scope.prompts?.image_a ?? startFrame?.prompt ?? "",
          videoModel: project.video_model,
          seconds,
          sceneMeta: scope.sceneMeta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "prompt failed");
      setPromptText(data.prompt);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generateImage() {
    if (!project) return;
    if (tab === "video") {
      alert("Switch to the Frame A or Frame B tab to generate an image.");
      return;
    }
    if (!promptText.trim()) {
      alert("Write or edit a prompt first.");
      return;
    }
    if (!activeInputs.length) {
      alert("Need at least one input image (reference, frame A, or canvas shot).");
      return;
    }
    setBusy("Rendering image…");
    try {
      const res = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt: promptText,
          imageUrls: activeInputs.slice(0, imageModel.maxImages).map((i) => i.url),
          modelId: project.image_model,
          aspectRatio: "16:9",
          metadata: scope.genMetadata(tab === "image_b" ? "end" : "start"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "generation failed");
      addAssets(data.assets);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generateVideo() {
    if (!project) return;
    const videoPrompt = scope.prompts?.video ?? "";
    if (!videoPrompt.trim()) {
      alert("Write the video prompt first (Video tab).");
      return;
    }
    const start =
      startFrame ??
      [...assets].reverse().find((a) => a.type === "image") ??
      null;
    if (!start) {
      alert("Pick a start frame (select an image and press “Start frame”).");
      return;
    }
    setBusy(`${videoModel.label} is rendering… this can take a few minutes`);
    try {
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt: videoPrompt,
          modelId: project.video_model,
          startImageUrl: start.url,
          endImageUrl:
            videoModel.supportsEndFrame && endFrame ? endFrame.url : undefined,
          duration: seconds,
          metadata: scope.genMetadata("video"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "generation failed");
      addAssets([data.asset]);
      scope.assignVideo(data.asset.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border border-border-soft">
      <div className="flex items-center justify-between border-b border-border-soft px-2 py-1">
        <div className="flex items-center gap-0">
          {(Object.keys(TAB_LABEL) as PromptTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
                tab === t
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-soft text-muted hover:border-border"
              }`}
            >
              {TAB_LABEL[t]}
              {scope.prompts?.[t] ? " ●" : ""}
            </button>
          ))}
          <span className="ml-3 font-mono text-[10px] text-muted">
            {busy ?? ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 font-mono text-[10px] text-muted">
            sec
            <input
              type="number"
              min={2}
              max={15}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              className="ml-1 w-12 border border-border-soft bg-transparent px-1 py-0.5 text-center font-mono text-[10px] outline-none"
            />
          </label>
          <button
            onClick={writePrompt}
            disabled={!!busy || (tab === "image_b" && !startFrame)}
            className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
            title={
              tab === "image_b" && !startFrame
                ? "Mark a start frame (A) first"
                : `Have Grok write the ${TAB_LABEL[tab]} prompt`
            }
          >
            ✦ Write {TAB_LABEL[tab]} prompt
          </button>
          <button
            onClick={generateImage}
            disabled={!!busy || tab === "video"}
            className="border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
          >
            Generate image
          </button>
          <button
            onClick={generateVideo}
            disabled={!!busy}
            className="border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-foreground hover:text-background disabled:opacity-40"
          >
            Generate video
          </button>
        </div>
      </div>

      <textarea
        value={promptText}
        onChange={(e) => setPromptText(e.target.value)}
        placeholder={
          tab === "video"
            ? "The video prompt. ✦ Write it, then shape it by hand — autosaves."
            : `The ${TAB_LABEL[tab]} image prompt. ✦ Write it, then shape it by hand — autosaves.`
        }
        rows={4}
        className="w-full resize-y bg-transparent p-2 font-mono text-xs leading-relaxed outline-none"
      />

      {/* One row, horizontal scroll — adding inputs never wraps or resizes.
          Also a drop target: drag any image thumbnail from the preview rail
          here to add it as a generation input. */}
      <div
        className={`flex items-center gap-1 overflow-x-auto border-t px-2 py-1 ${
          dropActive ? "border-foreground bg-panel" : "border-border-soft"
        }`}
        onDragOver={(e) => {
          if (tab !== "video" && e.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleAssetDrop}
      >
        <span className="shrink-0 font-mono text-[9px] uppercase text-muted">inputs:</span>
        {visibleCandidates.length === 0 && extras.length === 0 ? (
          <span className="shrink-0 font-mono text-[9px] text-muted">
            none — drag a thumbnail here
          </span>
        ) : (
          visibleCandidates.map((c) => (
            <button
              key={c.key}
              onClick={() =>
                setExcluded((prev) => new Set(prev).add(c.key))
              }
              className="flex shrink-0 items-center gap-1 whitespace-nowrap border border-border py-0.5 pl-0.5 pr-1.5 font-mono text-[9px]"
              title="Remove from inputs (↺ or drag it back to restore)"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.url}
                alt=""
                className="h-5 w-8 shrink-0 object-cover"
                loading="lazy"
              />
              {c.role} ×
            </button>
          ))
        )}
        {tab !== "video" &&
          extras.map((c) => (
            <button
              key={c.key}
              onClick={() =>
                setExtras((prev) => prev.filter((x) => x.key !== c.key))
              }
              className="flex shrink-0 items-center gap-1 whitespace-nowrap border border-foreground py-0.5 pl-0.5 pr-1.5 font-mono text-[9px]"
              title="Dragged-in input — click to remove"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.url}
                alt=""
                className="h-5 w-8 shrink-0 object-cover"
                loading="lazy"
              />
              {c.role} ×
            </button>
          ))}
        {removedCandidates.length > 0 && (
          <button
            onClick={() =>
              setExcluded((prev) => {
                const next = new Set(prev);
                removedCandidates.forEach((c) => next.delete(c.key));
                return next;
              })
            }
            className="shrink-0 whitespace-nowrap border border-border-soft px-1.5 py-0.5 font-mono text-[9px] text-muted hover:border-border hover:text-foreground"
            title="Bring back the removed inputs"
          >
            ↺ {removedCandidates.length} removed
          </button>
        )}
        {tab === "video" && (
          <span className="ml-auto shrink-0 font-mono text-[9px] text-muted">
            {startFrame ? "frame A set" : "auto start: latest image"}
            {videoModel.supportsEndFrame && endFrame ? " + frame B" : ""}
          </span>
        )}
      </div>
    </section>
  );
}
