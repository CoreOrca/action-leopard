"use client";

import { useCallback, useMemo, useRef } from "react";
import { useWorkspace } from "@/lib/store";
import { useSceneAgent } from "@/lib/scene-store";
import { patchShot } from "@/lib/shots";
import { computeResume } from "@/lib/scene-agent";
import type { Asset, Shot, ShotSpec } from "@/lib/types";

type Prompts = { image_a?: string; image_b?: string; video?: string };

export interface ShotScope {
  /** True when a scene project's fix-it view is scoped to a specific shot. */
  scoped: boolean;
  shot: Shot | null;
  prompts: Prompts;
  /** Persists to the shot when scoped, else to the project (store + debounced DB). */
  setPrompts: (next: Prompts) => void;
  startFrameId: string | null;
  endFrameId: string | null;
  setStartFrame: (id: string | null) => void;
  setEndFrame: (id: string | null) => void;
  /** Records a generated clip on the scoped shot (no-op unscoped). */
  assignVideo: (assetId: string) => void;
  /** Location reference for the prompt inputs. */
  referenceUrl: string | null;
  /** Palette/preview asset filter for the current scope. */
  filterAssets: (assets: Asset[]) => Asset[];
  /** The asset currently showing in the Preview panel (explicit selection,
   *  else the scope's default: shot clip → start frame → latest frame). */
  previewAsset: Asset | null;
  /** Asset metadata for generations, tagging shot versions. Undefined unscoped. */
  genMetadata: (
    role: "start" | "end" | "video"
  ) => Record<string, unknown> | undefined;
  /** Intent text for prompt writing — includes the shot spec when scoped. */
  intent: string;
  /** Scene meta (scale anchors) for prompt writing. */
  sceneMeta: { summary?: string; scale_anchors?: string[] };
}

const PALETTE_TYPES = [
  "image",
  "canvas-shot",
  "drawing",
  "reference",
  "art-direction",
  "element",
];

/** Compose the per-shot intent block the prompt writer sees. */
export function shotIntent(projectIntent: string, shot: Shot): string {
  const spec = shot.spec as Partial<ShotSpec>;
  if (!spec?.description) return projectIntent;
  return [
    projectIntent,
    "",
    `THIS SHOT${shot.title ? ` — ${shot.title}` : ""}:`,
    spec.description,
    spec.blocking ? `BLOCKING: ${spec.blocking}` : "",
    spec.camera ? `CAMERA: ${spec.camera}` : "",
    spec.screen_direction ? `SCREEN DIRECTION (invariant): ${spec.screen_direction}` : "",
    spec.entry_continuity ? `AT SHOT START: ${spec.entry_continuity}` : "",
    spec.exit_continuity ? `AT SHOT END: ${spec.exit_continuity}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function useShotScope(
  onPatchProject?: (patch: Record<string, unknown>) => void
): ShotScope {
  const {
    project,
    patchProject,
    assets,
    selectedAssetId,
    startFrameId,
    endFrameId,
    setStartFrame,
    setEndFrame,
  } = useWorkspace();
  const { activeShotId, view, shots, patchShotLocal } = useSceneAgent();

  const shot =
    project?.project_type === "scene" && view === "fixit" && activeShotId
      ? shots.find((s) => s.id === activeShotId) ?? null
      : null;
  const scoped = !!shot;

  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPrompts = useCallback(
    (next: Prompts) => {
      if (shot) {
        patchShotLocal(shot.id, { prompts: next });
        if (promptTimer.current) clearTimeout(promptTimer.current);
        promptTimer.current = setTimeout(() => {
          patchShot(shot.id, { prompts: next }).catch(() => {});
        }, 800);
      } else {
        patchProject({ prompts: next });
        onPatchProject?.({ prompts: next });
      }
    },
    [shot, patchShotLocal, patchProject, onPatchProject]
  );

  const setStart = useCallback(
    (id: string | null) => {
      if (shot) {
        // Marking a start frame IS approval: an escalated ("needs you") or
        // still-planned shot the user just chose a frame for is accepted.
        const patch: Partial<Shot> = { start_asset_id: id };
        if (id && ["escalated", "planned"].includes(shot.status))
          patch.status = "accepted";
        patchShotLocal(shot.id, patch);
        patchShot(shot.id, patch).catch(() => {});
        if (patch.status) {
          const scene = useSceneAgent.getState();
          scene.setPhase(computeResume(scene.shots).phase);
        }
      } else setStartFrame(id);
    },
    [shot, patchShotLocal, setStartFrame]
  );

  const setEnd = useCallback(
    (id: string | null) => {
      if (shot) {
        patchShotLocal(shot.id, { end_asset_id: id });
        patchShot(shot.id, { end_asset_id: id }).catch(() => {});
      } else setEndFrame(id);
    },
    [shot, patchShotLocal, setEndFrame]
  );

  const assignVideo = useCallback(
    (assetId: string) => {
      if (!shot) return;
      patchShotLocal(shot.id, { video_asset_id: assetId });
      patchShot(shot.id, { video_asset_id: assetId }).catch(() => {});
    },
    [shot, patchShotLocal]
  );

  const filterAssets = useCallback(
    (all: Asset[]) => {
      if (!shot) return all.filter((a) => PALETTE_TYPES.includes(a.type));
      // Scoped: this shot's tagged assets + shared references/art direction.
      return all.filter(
        (a) =>
          a.metadata?.shot_id === shot.id ||
          ["reference", "art-direction", "element", "canvas-shot"].includes(a.type)
      );
    },
    [shot]
  );

  const genMetadata = useCallback(
    (role: "start" | "end" | "video") => {
      if (!shot) return undefined;
      const version =
        assets.filter(
          (a) =>
            a.metadata?.shot_id === shot.id && a.metadata?.shot_role === role
        ).length + 1;
      return { shot_id: shot.id, shot_role: role, version };
    },
    [shot, assets]
  );

  // Single source of truth for what the Preview panel is displaying, so the
  // canvas tools (segmentation, annotate) can target the same image. Scoped:
  // only honor a selection inside the shot's own set — agent generations for
  // OTHER shots must never replace what the user is looking at.
  const previewAsset = useMemo(() => {
    const selectedRaw = assets.find((a) => a.id === selectedAssetId);
    if (!shot) {
      return (
        selectedRaw ??
        [...assets].reverse().find((a) => a.type === "image") ??
        assets[assets.length - 1] ??
        null
      );
    }
    const images = filterAssets(assets);
    const inShotSet =
      selectedRaw && images.some((i) => i.id === selectedRaw.id)
        ? selectedRaw
        : undefined;
    return (
      inShotSet ??
      images.find((a) => a.id === shot.video_asset_id) ??
      images.find((a) => a.id === shot.start_asset_id) ??
      [...images]
        .reverse()
        .find((a) => a.metadata?.shot_id === shot.id && a.type === "image") ??
      [...images].reverse().find((a) => a.type === "image") ??
      images[images.length - 1] ??
      null
    );
  }, [assets, selectedAssetId, shot, filterAssets]);

  const spec = shot?.spec as Partial<ShotSpec> | undefined;

  const referenceUrl = useMemo(() => {
    if (!shot) return project?.reference_image_url ?? null;
    const loc =
      project?.location_map?.find((l) => l.asset_id === shot.location_asset_id) ??
      project?.location_map?.[0];
    return loc?.url ?? project?.reference_image_url ?? null;
  }, [shot, project]);

  return {
    scoped,
    shot,
    prompts: (shot ? shot.prompts : project?.prompts) ?? {},
    setPrompts,
    startFrameId: shot ? shot.start_asset_id : startFrameId,
    endFrameId: shot ? shot.end_asset_id : endFrameId,
    setStartFrame: setStart,
    setEndFrame: setEnd,
    assignVideo,
    referenceUrl,
    filterAssets,
    previewAsset,
    genMetadata,
    intent: shot && project ? shotIntent(project.intent, shot) : project?.intent ?? "",
    sceneMeta: shot
      ? {
          summary: spec?.description,
          scale_anchors: spec?.scale_anchors ?? project?.scene_meta?.scale_anchors,
        }
      : project?.scene_meta ?? {},
  };
}
