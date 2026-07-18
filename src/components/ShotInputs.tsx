"use client";

import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import { shotGenerationInputs } from "@/lib/scene-agent";

/**
 * Shot detail: the exact inputs the generator receives for the scoped shot —
 * which location image, which element images (character/prop/vehicle), which
 * art direction images, and the continuity frame, in the order they attach.
 */
export default function ShotInputs() {
  const { project, elements } = useWorkspace();
  const { view, activeShotId, shots } = useSceneAgent();
  const shot =
    project?.project_type === "scene" && view === "fixit" && activeShotId
      ? shots.find((s) => s.id === activeShotId) ?? null
      : null;

  if (!project || !shot || shot.kind !== "shot") return null;

  const chips = shotGenerationInputs(project, shot);
  if (!chips.length) return null;

  const loc =
    project.location_map?.find((l) => l.asset_id === shot.location_asset_id) ??
    project.location_map?.[0];

  const label = (key: string) => {
    if (key === "location") return `location — ${loc?.label || "reference"}`;
    if (key === "prev-shot-frame") return "prev shot frame (continuity)";
    if (key === "art-direction") return "art direction (style only)";
    if (key.startsWith("element:")) {
      const name = key.slice("element:".length);
      const el = elements.find((e) => e.name === name);
      return `element — ${el ? `${el.kind}: ${el.name}` : name}`;
    }
    return key;
  };

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border border-border-soft px-2 py-1.5">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-muted">
        Generator inputs
      </span>
      {chips.map((c, i) => (
        <div
          key={`${c.key}-${i}`}
          className="flex shrink-0 items-center gap-1.5 border border-border-soft p-0.5"
          title={c.role}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.url}
            alt=""
            className="aspect-video h-9 object-cover"
            loading="lazy"
          />
          <span className="pr-1 font-mono text-[9px] uppercase tracking-wider text-muted">
            {i + 1}. {label(c.key)}
          </span>
        </div>
      ))}
    </div>
  );
}
