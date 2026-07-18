export type ElementKind =
  | "character"
  | "prop"
  | "vehicle"
  | "location"
  | "set-dressing"
  | "other";

export type AssetType =
  | "image"
  | "video"
  | "canvas-shot"
  | "drawing"
  | "reference"
  | "art-direction";

export type ProjectType = "shot" | "scene";

/** One stop on the path the scene's action travels through, in order. */
export interface LocationMapEntry {
  asset_id: string;
  url: string;
  label: string;
  notes?: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  intent: string;
  art_direction: string;
  reference_image_url: string | null;
  canvas_snapshot: unknown | null;
  current_prompt: string;
  prompts: { image_a?: string; image_b?: string; video?: string };
  scene_meta: { summary?: string; scale_anchors?: string[] };
  image_model: string;
  video_model: string;
  project_type: ProjectType;
  script: string;
  location_map: LocationMapEntry[];
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Element {
  id: string;
  project_id: string;
  user_id: string;
  kind: ElementKind;
  name: string;
  notes: string;
  image_url: string | null;
  created_at: string;
}

export interface Asset {
  id: string;
  project_id: string;
  user_id: string;
  type: AssetType;
  url: string;
  thumbnail_url: string | null;
  prompt: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  sort_order: number;
  created_at: string;
}

/** One object recognized in the reference image, placed on the canvas. */
export interface SceneObject {
  id: string;
  label: string;
  kind: ElementKind | "architecture" | "nature" | "ground" | "sky";
  /** Normalized bounding box in the source image, 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** tldraw color name, e.g. "grey", "light-blue", "orange" */
  color: string;
  /** Geometry hint for the shape */
  geo:
    | "rectangle"
    | "ellipse"
    | "triangle"
    | "diamond"
    | "trapezoid"
    | "arrow-right"
    | "arrow-left"
    | "cloud"
    | "star"
    | "hexagon";
  /** True if this object could move during the action (vehicle, person, crane arm...) */
  mobile: boolean;
  notes?: string;
  /** Outline mode: normalized [x,y] points (0..1 in image space) tracing the silhouette */
  outline?: [number, number][];
}

export interface SceneTranslation {
  summary: string;
  horizon_y: number | null;
  objects: SceneObject[];
  /** Real-world dimension estimates for key objects, e.g. "the orange walkway is about 10 feet wide" */
  scale_anchors?: string[];
}

export type SceneMode = "blocks" | "outlines" | "traced" | "cutouts";

/** Cutouts quality path: Fast = SAM only; Cinematic = atlas (+ plate when subjects). */
export type SceneQuality = "fast" | "cinematic";

/* ---------------------------------------------------------------------------
 * Scene projects: planned shots + self-correcting loop
 * ------------------------------------------------------------------------- */

export type ShotKind = "shot" | "transition";

export type ShotStatus =
  | "planned"
  | "approved"
  | "generating"
  | "judging"
  | "fixing"
  | "passed"
  | "escalated"
  | "accepted";

export type ActionDirectiveKey =
  | "car-chase"
  | "foot-chase"
  | "fight"
  | "boat-chase"
  | "aircraft"
  | "space";

/**
 * The planner's spec for one shot. Continuity fields describe WORLD/ACTION
 * state (positions along the location path, direction of travel, who is
 * where) — never camera framing. The camera varies freely between shots.
 */
export interface ShotSpec {
  /** The single beat of action this shot covers (≈5s). */
  description: string;
  /** Who/what is where, in screen-space terms. */
  blocking: string;
  /** Shot type + camera behavior; varies shot-to-shot for cinematic rhythm. */
  camera: string;
  /** Which part/segment of the mapped location image this shot lives in. */
  location_note: string;
  /** World state at shot start (= previous shot's exit_continuity). */
  entry_continuity: string;
  /** World state at shot end (feeds the next shot's entry_continuity). */
  exit_continuity: string;
  /** Persistent invariant, e.g. "cars travel screen left→right, ocean frame-left". */
  screen_direction: string;
  directive?: ActionDirectiveKey;
  /** Real-world dimension estimates for this shot's location segment. */
  scale_anchors?: string[];
}

export type JudgeCheckId =
  | "location-fidelity"
  | "scale-proportion"
  | "screen-direction"
  | "continuity-adjacent"
  | "anatomy"
  | "script-intent"
  | "art-direction";

export interface JudgeCheck {
  id: JudgeCheckId;
  pass: boolean;
  issue?: string;
}

export interface JudgeFix {
  strategy: "revise-prompt" | "change-inputs" | "canvas-blocking";
  notes: string;
  revised_prompt?: string;
  /** Role keys to add/remove from the generation inputs, e.g. "location", "prev-shot-frame". */
  inputs?: { add?: string[]; remove?: string[] };
}

export interface JudgeVerdict {
  /** Which frame version was judged (1 = first generation). */
  version: number;
  /** The judge's observe-first pass: visible faces, landmark edges, obstacles. */
  observed?: string;
  pass: boolean;
  checks: JudgeCheck[];
  summary: string;
  fix?: JudgeFix;
}

export interface Shot {
  id: string;
  project_id: string;
  user_id: string;
  kind: ShotKind;
  sort_order: number;
  title: string;
  script_excerpt: string;
  spec: ShotSpec | Record<string, never>;
  location_asset_id: string | null;
  prompts: { image_a?: string; image_b?: string; video?: string };
  status: ShotStatus;
  revision_count: number;
  judge: { last?: JudgeVerdict; history?: JudgeVerdict[] };
  start_asset_id: string | null;
  end_asset_id: string | null;
  video_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

/** One shot as returned by /api/scene/plan, before insertion. */
export interface PlannedShot {
  shot_number: number;
  title: string;
  script_excerpt: string;
  /** Index into project.location_map for the mapped location image. */
  location_index: number;
  spec: ShotSpec;
  image_a_prompt: string;
}

export interface ScenePlan {
  summary: string;
  shots: PlannedShot[];
}
