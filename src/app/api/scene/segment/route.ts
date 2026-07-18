import { NextResponse } from "next/server";
import { fal } from "@/lib/fal";

export const maxDuration = 300;

interface SegmentObject {
  id: string;
  /** Human label from scene translation, e.g. "black BMW i5" */
  label?: string;
  kind?: string;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

interface Sam3Output {
  image?: { url: string };
  masks?: { url: string }[];
  scores?: (number | null)[];
  boxes?: (number[] | null)[];
  metadata?: { index: number; score?: number | null; box?: number[] | null }[];
}

const MAX_OBJECTS = 24;
const CONCURRENCY = 4;

/** Map object kind/label → a concise open-vocab text concept for SAM 3.1. */
function textConcept(obj: SegmentObject): string {
  const label = (obj.label ?? "").trim();
  const kind = (obj.kind ?? "").toLowerCase();

  // Prefer the concrete label when it is short and descriptive.
  if (label && label.length <= 48) {
    // Strip filler that confuses open-vocab models.
    const cleaned = label
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) return cleaned;
  }

  const kindMap: Record<string, string> = {
    vehicle: "car",
    character: "person",
    prop: "object",
    "set-dressing": "object",
    architecture: "building",
    nature: "rock",
    ground: "ground",
    location: "structure",
    other: "object",
  };
  return kindMap[kind] ?? "object";
}

/** IoU between a pixel-space box and a normalized cxcywh box. */
function iouBoxToCxcywh(
  box: { x_min: number; y_min: number; x_max: number; y_max: number },
  cxcywh: number[],
  // SAM returns normalized coords; we only need relative IoU so image size cancels
  // if both are treated consistently. cxcywh is 0..1; convert our box to 0..1 via
  // the box extents as a proxy when image dims unknown — caller passes normalized box.
  imageW: number,
  imageH: number
): number {
  if (cxcywh.length < 4 || imageW <= 0 || imageH <= 0) return 0;
  const [cx, cy, bw, bh] = cxcywh;
  const ax1 = box.x_min / imageW;
  const ay1 = box.y_min / imageH;
  const ax2 = box.x_max / imageW;
  const ay2 = box.y_max / imageH;
  const bx1 = cx - bw / 2;
  const by1 = cy - bh / 2;
  const bx2 = cx + bw / 2;
  const by2 = cy + bh / 2;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const aArea = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const bArea = Math.max(0, bw) * Math.max(0, bh);
  const union = aArea + bArea - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Pick the best mask index from multi-mask SAM output using confidence
 * score and spatial overlap with the prompt box.
 */
function pickBestMaskIndex(
  data: Sam3Output,
  box: SegmentObject,
  imageW: number,
  imageH: number
): number {
  const n = data.masks?.length ?? 0;
  if (n <= 1) return 0;

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const conf =
      data.scores?.[i] ??
      data.metadata?.[i]?.score ??
      0.5;
    const cxcywh =
      data.boxes?.[i] ??
      data.metadata?.[i]?.box ??
      null;
    const iou = cxcywh
      ? iouBoxToCxcywh(box, cxcywh, imageW, imageH)
      : 0.3;
    // Prefer high confidence + good spatial agreement.
    const combined = conf * 0.55 + iou * 0.45;
    if (combined > bestScore) {
      bestScore = combined;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Per-object segmentation with SAM 3.1.
 *
 * Uses text concept + box + center point so whole semantic objects (cars,
 * people, props) are isolated rather than patchy box-only regions.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    imageUrl: string;
    boxes: SegmentObject[];
    /** Optional pixel dimensions of the source image (improves IoU ranking). */
    imageW?: number;
    imageH?: number;
  };
  const { imageUrl, boxes, imageW = 1024, imageH = 1024 } = body;

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
        const xMin = Math.round(box.x_min);
        const yMin = Math.round(box.y_min);
        const xMax = Math.round(box.x_max);
        const yMax = Math.round(box.y_max);
        const cx = Math.round((xMin + xMax) / 2);
        const cy = Math.round((yMin + yMax) / 2);
        // Slightly expand the box so SAM is not starved on tight grok boxes.
        const padX = Math.max(4, Math.round((xMax - xMin) * 0.06));
        const padY = Math.max(4, Math.round((yMax - yMin) * 0.06));
        const bxMin = Math.max(0, xMin - padX);
        const byMin = Math.max(0, yMin - padY);
        const bxMax = xMax + padX;
        const byMax = yMax + padY;

        const result = await fal.subscribe("fal-ai/sam-3-1/image", {
          input: {
            image_url: imageUrl,
            prompt: textConcept(box),
            box_prompts: [
              {
                x_min: bxMin,
                y_min: byMin,
                x_max: bxMax,
                y_max: byMax,
                object_id: 0,
              },
            ],
            point_prompts: [
              {
                x: cx,
                y: cy,
                // 1 = foreground (fal client types this as string enum)
                label: 1 as unknown as "1",
                object_id: 0,
              },
            ],
            apply_mask: false,
            output_format: "png",
            return_multiple_masks: true,
            max_masks: 3,
            include_scores: true,
            include_boxes: true,
          },
          logs: false,
        });

        const data = result.data as Sam3Output;
        if (!data.masks?.length) {
          return {
            id: box.id,
            maskUrl: data.image?.url ?? null,
          };
        }
        const idx = pickBestMaskIndex(data, box, imageW, imageH);
        return {
          id: box.id,
          maskUrl: data.masks[idx]?.url ?? data.masks[0]?.url ?? null,
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

  return NextResponse.json({
    masks: results,
    truncated: boxes.length > MAX_OBJECTS,
  });
}
