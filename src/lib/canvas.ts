"use client";

import {
  AssetRecordType,
  createShapeId,
  toRichText,
  type Editor,
  type IndexKey,
  type TLShapeId,
} from "tldraw";
import { upload } from "@vercel/blob/client";
import { createClient } from "./supabase/client";
import type { Asset, SceneTranslation } from "./types";

const STAGE_W = 1600;
const STAGE_H = 900;

const VALID_COLORS = new Set([
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white",
]);

const VALID_GEO = new Set([
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "trapezoid",
  "hexagon",
  "cloud",
  "star",
  "arrow-right",
  "arrow-left",
]);

/**
 * The magic moment: build a movable blocking scene on the canvas from a
 * SceneTranslation. Larger objects are created first so they sit behind.
 * Shapes are staggered in with a slight delay so the scene assembles itself.
 */
export async function sceneToCanvas(
  editor: Editor,
  scene: SceneTranslation,
  opts: { animate?: boolean } = { animate: true }
) {
  const sorted = [...scene.objects].sort((a, b) => b.w * b.h - a.w * a.h);

  if (scene.horizon_y != null) {
    editor.createShape({
      id: createShapeId(),
      type: "line",
      x: 0,
      y: scene.horizon_y * STAGE_H,
      props: {
        color: "grey",
        dash: "dashed",
        points: {
          a1: { id: "a1", index: "a1" as IndexKey, x: 0, y: 0 },
          a2: { id: "a2", index: "a2" as IndexKey, x: STAGE_W, y: 0 },
        },
      },
    });
  }

  for (const obj of sorted) {
    const id = createShapeId();
    const w = Math.max(obj.w * STAGE_W, 40);
    const h = Math.max(obj.h * STAGE_H, 40);
    editor.createShape({
      id,
      type: "geo",
      x: obj.x * STAGE_W,
      y: obj.y * STAGE_H,
      props: {
        geo: (VALID_GEO.has(obj.geo) ? obj.geo : "rectangle") as "rectangle",
        w,
        h,
        color: (VALID_COLORS.has(obj.color)
          ? obj.color
          : "grey") as "grey",
        fill: "semi",
        dash: obj.mobile ? "draw" : "solid",
        size: "s",
        font: "mono",
        richText: toRichText(obj.label),
      },
      meta: {
        label: obj.label,
        kind: obj.kind,
        mobile: obj.mobile,
        source: "scene-translation",
      },
    });
    if (opts.animate) {
      editor.zoomToFit({ animation: { duration: 120 } });
      await new Promise((r) => setTimeout(r, 90));
    }
  }
  editor.zoomToFit({ animation: { duration: 300 } });
}

/** Export the current page (or selection) as a PNG blob. */
export async function exportCanvasPng(editor: Editor): Promise<Blob> {
  const ids = [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) throw new Error("Canvas is empty");
  const { blob } = await editor.toImage(ids, {
    format: "png",
    background: true,
    scale: 1,
    padding: 16,
  });
  return blob;
}

/** Upload a blob via client upload and create an asset row. Returns the asset. */
export async function saveBlobAsAsset(
  blob: Blob | File,
  opts: {
    projectId: string;
    type: Asset["type"];
    pathname: string;
    prompt?: string;
    model?: string;
    metadata?: Record<string, unknown>;
    sortOrderHint?: number;
  }
): Promise<Asset> {
  const uploaded = await upload(opts.pathname, blob, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
  });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("assets")
    .insert({
      project_id: opts.projectId,
      user_id: user.id,
      type: opts.type,
      url: uploaded.url,
      prompt: opts.prompt ?? null,
      model: opts.model ?? null,
      metadata: opts.metadata ?? {},
      sort_order: opts.sortOrderHint ?? 0,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Asset;
}

/** Place an image on the canvas as a locked background for annotation. */
export async function imageToCanvasBackground(editor: Editor, url: string) {
  const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });

  const scale = Math.min(STAGE_W / dims.w, STAGE_H / dims.h, 1);
  const w = dims.w * scale;
  const h = dims.h * scale;

  const assetId = AssetRecordType.createId();
  editor.createAssets([
    {
      id: assetId,
      typeName: "asset",
      type: "image",
      props: {
        name: "background",
        src: url,
        w,
        h,
        mimeType: "image/png",
        isAnimated: false,
      },
      meta: {},
    },
  ]);

  const shapeId: TLShapeId = createShapeId();
  editor.createShape({
    id: shapeId,
    type: "image",
    x: 0,
    y: 0,
    props: { assetId, w, h },
    meta: { source: "annotate-background" },
  });
  editor.sendToBack([shapeId]);
  editor.updateShapes([{ id: shapeId, type: "image", isLocked: true }]);
  editor.zoomToFit({ animation: { duration: 200 } });
}

/** Clear all shapes from the current page. */
export function clearCanvas(editor: Editor) {
  const ids = [...editor.getCurrentPageShapeIds()];
  if (!ids.length) return;
  editor.updateShapes(
    ids.map((id) => ({ id, type: editor.getShape(id)!.type, isLocked: false }))
  );
  editor.deleteShapes(ids);
}
