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
  image_model: string;
  video_model: string;
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
}

export interface SceneTranslation {
  summary: string;
  horizon_y: number | null;
  objects: SceneObject[];
}
