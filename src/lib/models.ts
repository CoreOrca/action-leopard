export interface ImageModelDef {
  id: string;
  label: string;
  falId: string;
  /** Max reference images accepted */
  maxImages: number;
}

export interface VideoModelDef {
  id: string;
  label: string;
  falId: string;
  /** Accepts an end frame in addition to the start frame */
  supportsEndFrame: boolean;
  /** Accepts a guide/input video */
  supportsVideoInput: boolean;
  resolution?: "480p" | "720p" | "1080p";
}

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    falId: "fal-ai/gemini-3-pro-image-preview/edit",
    maxImages: 14,
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    falId: "fal-ai/nano-banana-2/edit",
    maxImages: 14,
  },
];

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: "grok-imagine-1.5-480p",
    label: "Grok Imagine 1.5 · 480p",
    falId: "xai/grok-imagine-video/v1.5/image-to-video",
    supportsEndFrame: false,
    supportsVideoInput: false,
    resolution: "480p",
  },
  {
    id: "grok-imagine-1.5-720p",
    label: "Grok Imagine 1.5 · 720p",
    falId: "xai/grok-imagine-video/v1.5/image-to-video",
    supportsEndFrame: false,
    supportsVideoInput: false,
    resolution: "720p",
  },
  {
    id: "grok-imagine-1.5-1080p",
    label: "Grok Imagine 1.5 · 1080p",
    falId: "xai/grok-imagine-video/v1.5/image-to-video",
    supportsEndFrame: false,
    supportsVideoInput: false,
    resolution: "1080p",
  },
  {
    id: "kling-3-pro",
    label: "Kling 3 Pro · start/end frame",
    falId: "fal-ai/kling-video/v3/pro/image-to-video",
    supportsEndFrame: true,
    supportsVideoInput: true,
  },
  {
    id: "seedance-2",
    label: "Seedance 2.0 · start/end frame",
    falId: "bytedance/seedance-2.0/image-to-video",
    supportsEndFrame: true,
    supportsVideoInput: false,
    resolution: "720p",
  },
  {
    id: "seedance-2-fast",
    label: "Seedance 2.0 Fast · refs + video input",
    falId: "bytedance/seedance-2.0/fast/reference-to-video",
    supportsEndFrame: false,
    supportsVideoInput: true,
    resolution: "720p",
  },
  {
    id: "kling-3-pro-motion",
    label: "Kling 3 Pro · motion control",
    falId: "fal-ai/kling-video/v3/pro/motion-control",
    supportsEndFrame: false,
    supportsVideoInput: true,
  },
];

export function getImageModel(id: string): ImageModelDef {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

export function getVideoModel(id: string): VideoModelDef {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS[1];
}

export const XAI_MODEL = "grok-4.5";
