"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/store";
import { getVideoModel } from "@/lib/models";

export default function PromptBar({
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
    assets,
    addAssets,
    startFrameId,
    endFrameId,
    busy,
    setBusy,
  } = useWorkspace();
  const [seconds, setSeconds] = useState(5);

  if (!project) return null;

  const startFrame = assets.find((a) => a.id === startFrameId);
  const endFrame = assets.find((a) => a.id === endFrameId);
  const latestCanvasShot = [...assets]
    .reverse()
    .find((a) => a.type === "canvas-shot");
  const artDirectionImages = assets
    .filter((a) => a.type === "art-direction")
    .slice(0, 2);
  const videoModel = getVideoModel(project.video_model);

  function collectImageInputs(): { url: string; role: string }[] {
    const inputs: { url: string; role: string }[] = [];
    if (startFrame) inputs.push({ url: startFrame.url, role: "frame A (start)" });
    else if (project?.reference_image_url)
      inputs.push({ url: project.reference_image_url, role: "location reference" });
    if (latestCanvasShot)
      inputs.push({ url: latestCanvasShot.url, role: "canvas blocking sketch" });
    for (const a of artDirectionImages)
      inputs.push({ url: a.url, role: "art direction" });
    return inputs;
  }

  async function writePrompt(mode: "image-a" | "image-b" | "video") {
    if (!project) return;
    setBusy("Grok is writing the prompt…");
    try {
      const imageUrls =
        mode === "video"
          ? [
              ...(startFrame
                ? [{ url: startFrame.url, role: "start-frame" }]
                : []),
              ...(endFrame ? [{ url: endFrame.url, role: "end-frame" }] : []),
            ]
          : collectImageInputs();

      const res = await fetch("/api/prompt/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          intent: project.intent,
          artDirection: project.art_direction,
          elements: elements.map((e) => ({
            kind: e.kind,
            name: e.name,
            notes: e.notes,
          })),
          imageUrls,
          frameAPrompt: startFrame?.prompt ?? project.current_prompt,
          videoModel: project.video_model,
          seconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "prompt failed");
      patchProject({ current_prompt: data.prompt });
      onPatchProject({ current_prompt: data.prompt });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generateImage() {
    if (!project) return;
    if (!project.current_prompt.trim()) {
      alert("Write or edit a prompt first.");
      return;
    }
    const inputs = collectImageInputs();
    if (!inputs.length) {
      alert("Need at least one input image (reference, frame A, or canvas shot).");
      return;
    }
    setBusy("Nano Banana Pro is rendering…");
    try {
      const res = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt: project.current_prompt,
          imageUrls: inputs.map((i) => i.url),
          modelId: project.image_model,
          aspectRatio: "16:9",
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
          prompt: project.current_prompt,
          modelId: project.video_model,
          startImageUrl: start.url,
          endImageUrl:
            videoModel.supportsEndFrame && endFrame ? endFrame.url : undefined,
          duration: seconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "generation failed");
      addAssets([data.asset]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border border-border-soft">
      <div className="flex items-center justify-between border-b border-border-soft px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Prompt {busy ? `· ${busy}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <label className="mr-2 font-mono text-[10px] text-muted">
            sec
            <input
              type="number"
              min={1}
              max={15}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              className="ml-1 w-12 border border-border-soft bg-transparent px-1 py-0.5 text-center font-mono text-[10px] outline-none"
            />
          </label>
          <button
            onClick={() => writePrompt("image-a")}
            disabled={!!busy}
            className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
            title="Write a staging (frame A) image prompt"
          >
            ✦ Frame A prompt
          </button>
          <button
            onClick={() => writePrompt("image-b")}
            disabled={!!busy || !startFrame}
            className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
            title="Write a 'same scene, N seconds later' frame B prompt from the selected start frame"
          >
            ✦ Frame B prompt
          </button>
          <button
            onClick={() => writePrompt("video")}
            disabled={!!busy}
            className="border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-border disabled:opacity-40"
          >
            ✦ Video prompt
          </button>
          <button
            onClick={generateImage}
            disabled={!!busy}
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
        value={project.current_prompt}
        onChange={(e) => {
          patchProject({ current_prompt: e.target.value });
          onPatchProject({ current_prompt: e.target.value });
        }}
        placeholder="The working prompt. Let Grok write it, then shape it by hand — it autosaves."
        rows={4}
        className="w-full resize-y bg-transparent p-2 font-mono text-xs leading-relaxed outline-none"
      />
      <div className="border-t border-border-soft px-2 py-1 font-mono text-[9px] text-muted">
        image inputs:{" "}
        {collectImageInputs()
          .map((i) => i.role)
          .join(" · ") || "none"}
        {" — "}video: {startFrame ? "frame A set" : "auto (latest image)"}
        {videoModel.supportsEndFrame && endFrame ? " + frame B" : ""}
      </div>
    </section>
  );
}
