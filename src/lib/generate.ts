import { fal } from "./fal";
import { copyToBlob } from "./blob";
import { getImageModel, getVideoModel } from "./models";
import { createClient } from "./supabase/server";
import { assertCredits, recordUsage } from "./entitlements";
import { IMAGE_CREDITS, videoCredits } from "./plans";
import type { Asset } from "./types";

interface FalImageOutput {
  images: { url: string; width?: number; height?: number }[];
  description?: string;
}

interface FalVideoOutput {
  video: { url: string };
}

/** Unwrap fal's validation detail so a 422 says WHAT was rejected, not just
 *  "Unprocessable Entity". */
function falError(err: unknown): Error {
  const e = err as { message?: string; body?: { detail?: unknown } };
  const detail = e?.body?.detail;
  if (detail) {
    const text = Array.isArray(detail)
      ? detail
          .map((d) => {
            if (typeof d === "string") return d;
            const o = d as { loc?: unknown[]; msg?: string };
            return `${o.loc?.join(".") || "input"}: ${o.msg ?? JSON.stringify(d)}`;
          })
          .join("; ")
      : typeof detail === "string"
        ? detail
        : JSON.stringify(detail);
    return new Error(`fal rejected the request — ${text}`);
  }
  return err instanceof Error ? err : new Error(String(err));
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
  /** Extra metadata merged into the asset row (e.g. shot_id/shot_role/version). */
  metadata?: Record<string, unknown>;
}): Promise<Asset[]> {
  const model = getImageModel(opts.modelId);
  await assertCredits(IMAGE_CREDITS);

  // Pre-flight: drop unreachable inputs (e.g. a deleted blob still referenced
  // somewhere) instead of letting fal 422 the whole request and kill a run.
  const requested = opts.imageUrls.slice(0, model.maxImages);
  const checks = await Promise.all(
    requested.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
        });
        return res.ok;
      } catch {
        return false;
      }
    })
  );
  const inputs = requested.filter((_, i) => checks[i]);
  const dropped = requested.filter((_, i) => !checks[i]);
  if (!inputs.length)
    throw new Error(
      "No input image is reachable — a referenced image was probably deleted. Re-upload it or remove the stale input."
    );

  let result;
  try {
    result = await fal.subscribe(model.falId, {
      input: {
        prompt: opts.prompt,
        image_urls: inputs,
        num_images: 1,
        resolution: opts.resolution ?? "1K",
        output_format: "png",
        ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
      },
      logs: false,
    });
  } catch (err) {
    throw falError(err);
  }
  const output = result.data as FalImageOutput;
  await recordUsage(
    "image",
    opts.modelId,
    IMAGE_CREDITS * Math.max(1, output.images.length),
    { project_id: opts.projectId }
  );

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
          input_images: inputs,
          ...(dropped.length ? { dropped_inputs: dropped } : {}),
          ...(opts.metadata ?? {}),
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
  /** Extra metadata merged into the asset row (e.g. shot_id/shot_role/version). */
  metadata?: Record<string, unknown>;
}): Promise<Asset> {
  const model = getVideoModel(opts.modelId);
  const cost = videoCredits(opts.modelId, opts.duration);
  await assertCredits(cost);

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
  } else if (model.falId.includes("reference-to-video")) {
    // Seedance 2.0 Fast: multi-reference (@Image1/@Video1 in the prompt)
    input = {
      prompt: opts.prompt,
      image_urls: [opts.startImageUrl],
      ...(opts.videoUrl ? { video_urls: [opts.videoUrl] } : {}),
      resolution: model.resolution ?? "720p",
      duration: String(Math.min(Math.max(opts.duration ?? 5, 4), 15)),
      generate_audio: false,
    };
  } else if (model.falId.includes("seedance")) {
    input = {
      prompt: opts.prompt,
      image_url: opts.startImageUrl,
      resolution: model.resolution ?? "720p",
      duration: String(Math.min(Math.max(opts.duration ?? 5, 4), 15)),
      generate_audio: false,
      ...(model.supportsEndFrame && opts.endImageUrl
        ? { end_image_url: opts.endImageUrl }
        : {}),
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

  let result;
  try {
    result = await fal.subscribe(model.falId, { input, logs: false });
  } catch (err) {
    throw falError(err);
  }
  const output = result.data as FalVideoOutput;
  await recordUsage("video", opts.modelId, cost, {
    project_id: opts.projectId,
    duration: opts.duration ?? null,
  });

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
      ...(opts.metadata ?? {}),
    },
  });
}
