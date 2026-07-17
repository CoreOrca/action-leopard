import { fal } from "./fal";
import { copyToBlob } from "./blob";
import { getImageModel, getVideoModel } from "./models";
import { createClient } from "./supabase/server";
import type { Asset } from "./types";

interface FalImageOutput {
  images: { url: string; width?: number; height?: number }[];
  description?: string;
}

interface FalVideoOutput {
  video: { url: string };
}

async function insertAsset(
  projectId: string,
  fields: Partial<Asset> & { type: Asset["type"]; url: string }
): Promise<Asset> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: maxRow } = await supabase
    .from("assets")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("assets")
    .insert({
      project_id: projectId,
      user_id: user.id,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
      ...fields,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Asset;
}

export async function generateImage(opts: {
  projectId: string;
  prompt: string;
  imageUrls: string[];
  modelId: string;
  aspectRatio?: string;
  resolution?: "1K" | "2K" | "4K";
}): Promise<Asset[]> {
  const model = getImageModel(opts.modelId);
  const result = await fal.subscribe(model.falId, {
    input: {
      prompt: opts.prompt,
      image_urls: opts.imageUrls.slice(0, model.maxImages),
      num_images: 1,
      resolution: opts.resolution ?? "1K",
      output_format: "png",
      ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
    },
    logs: false,
  });
  const output = result.data as FalImageOutput;

  const assets: Asset[] = [];
  for (const img of output.images) {
    const blobUrl = await copyToBlob(
      img.url,
      `projects/${opts.projectId}/images/gen.png`
    );
    assets.push(
      await insertAsset(opts.projectId, {
        type: "image",
        url: blobUrl,
        prompt: opts.prompt,
        model: opts.modelId,
        metadata: {
          fal_url: img.url,
          width: img.width,
          height: img.height,
          description: output.description,
          input_images: opts.imageUrls,
        },
      })
    );
  }
  return assets;
}

export async function generateVideo(opts: {
  projectId: string;
  prompt: string;
  modelId: string;
  startImageUrl: string;
  endImageUrl?: string;
  videoUrl?: string;
  duration?: number;
}): Promise<Asset> {
  const model = getVideoModel(opts.modelId);

  let input: Record<string, unknown>;
  if (model.falId.includes("grok-imagine")) {
    input = {
      prompt: opts.prompt.slice(0, 4096),
      image_url: opts.startImageUrl,
      duration: Math.min(Math.max(opts.duration ?? 6, 1), 15),
      resolution: model.resolution ?? "720p",
    };
  } else if (model.falId.includes("motion-control")) {
    if (!opts.videoUrl) throw new Error("Motion control requires a guide video");
    input = {
      image_url: opts.startImageUrl,
      video_url: opts.videoUrl,
      character_orientation: "image",
      keep_original_sound: false,
      ...(opts.prompt ? { prompt: opts.prompt.slice(0, 2500) } : {}),
    };
  } else {
    // Kling 3 Pro image-to-video
    input = {
      prompt: opts.prompt.slice(0, 2500),
      start_image_url: opts.startImageUrl,
      duration: String(Math.min(Math.max(opts.duration ?? 5, 3), 15)),
      generate_audio: false,
      ...(opts.endImageUrl ? { end_image_url: opts.endImageUrl } : {}),
    };
  }

  const result = await fal.subscribe(model.falId, { input, logs: false });
  const output = result.data as FalVideoOutput;

  const blobUrl = await copyToBlob(
    output.video.url,
    `projects/${opts.projectId}/videos/gen.mp4`
  );
  return insertAsset(opts.projectId, {
    type: "video",
    url: blobUrl,
    thumbnail_url: opts.startImageUrl,
    prompt: opts.prompt,
    model: opts.modelId,
    metadata: {
      fal_url: output.video.url,
      start_image_url: opts.startImageUrl,
      end_image_url: opts.endImageUrl ?? null,
      video_input_url: opts.videoUrl ?? null,
      duration: opts.duration ?? null,
    },
  });
}
