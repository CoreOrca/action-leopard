import { NextResponse } from "next/server";
import { fal } from "@/lib/fal";

export const maxDuration = 300;

interface SegmentBox {
  id: string;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

interface Sam3Output {
  image?: { url: string };
  masks?: { url: string }[];
}

const MAX_OBJECTS = 24;
const CONCURRENCY = 4;

/**
 * Per-object segmentation with SAM 3.1: one call per bounding box so the
 * mask→object mapping is deterministic.
 */
export async function POST(request: Request) {
  const { imageUrl, boxes } = (await request.json()) as {
    imageUrl: string;
    boxes: SegmentBox[];
  };
  if (!imageUrl || !boxes?.length) {
    return NextResponse.json(
      { error: "imageUrl and boxes are required" },
      { status: 400 }
    );
  }

  const capped = boxes.slice(0, MAX_OBJECTS);
  const results: { id: string; maskUrl: string | null }[] = [];

  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const batch = capped.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (box) => {
        const result = await fal.subscribe("fal-ai/sam-3-1/image", {
          input: {
            image_url: imageUrl,
            box_prompts: [
              {
                x_min: Math.round(box.x_min),
                y_min: Math.round(box.y_min),
                x_max: Math.round(box.x_max),
                y_max: Math.round(box.y_max),
              },
            ],
            apply_mask: false,
            output_format: "png",
          },
          logs: false,
        });
        const data = result.data as Sam3Output;
        return {
          id: box.id,
          maskUrl: data.masks?.[0]?.url ?? data.image?.url ?? null,
        };
      })
    );
    settled.forEach((s, j) => {
      results.push(
        s.status === "fulfilled"
          ? s.value
          : { id: batch[j].id, maskUrl: null }
      );
    });
  }

  return NextResponse.json({ masks: results, truncated: boxes.length > MAX_OBJECTS });
}
