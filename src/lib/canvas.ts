"use client";

import {
  AssetRecordType,
  createShapeId,
  toRichText,
  type Editor,
  type IndexKey,
  type TLShapeId,
} from "tldraw";
import { compressLegacySegments } from "@tldraw/tlschema";
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
    const color = (VALID_COLORS.has(obj.color) ? obj.color : "grey") as "grey";
    const meta = {
      label: obj.label,
      kind: obj.kind,
      mobile: obj.mobile,
      source: "scene-translation",
    };

    if (obj.outline && obj.outline.length >= 3) {
      // Outline mode: a closed freehand silhouette + a grouped label.
      const pts = obj.outline.map(([px, py]) => ({
        x: px * STAGE_W,
        y: py * STAGE_H,
      }));
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const local = [...pts, pts[0]].map((p) => ({
        x: p.x - minX,
        y: p.y - minY,
        z: 0.5,
      }));

      const drawId = createShapeId();
      editor.createShape({
        id: drawId,
        type: "draw",
        x: minX,
        y: minY,
        props: {
          segments: compressLegacySegments([
            { type: "free", points: local },
          ]),
          isClosed: true,
          isComplete: true,
          color,
          fill: "semi",
          dash: obj.mobile ? "draw" : "solid",
          size: "s",
        },
        meta,
      });

      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const textId = createShapeId();
      editor.createShape({
        id: textId,
        type: "text",
        x: cx - 60,
        y: cy - 10,
        props: {
          richText: toRichText(obj.label),
          color,
          size: "s",
          font: "mono",
          autoSize: true,
        },
        meta,
      });
      editor.groupShapes([drawId, textId]);
    } else {
      editor.createShape({
        id: createShapeId(),
        type: "geo",
        x: obj.x * STAGE_W,
        y: obj.y * STAGE_H,
        props: {
          geo: (VALID_GEO.has(obj.geo) ? obj.geo : "rectangle") as "rectangle",
          w: Math.max(obj.w * STAGE_W, 40),
          h: Math.max(obj.h * STAGE_H, 40),
          color,
          fill: "semi",
          dash: obj.mobile ? "draw" : "solid",
          size: "s",
          font: "mono",
          richText: toRichText(obj.label),
        },
        meta,
      });
    }

    if (opts.animate) {
      editor.zoomToFit({ animation: { duration: 120 } });
      await new Promise((r) => setTimeout(r, 90));
    }
  }

  addScaleLegend(editor, scene);
  editor.zoomToFit({ animation: { duration: 300 } });
}

function addScaleLegend(editor: Editor, scene: SceneTranslation) {
  if (!scene.scale_anchors?.length) return;
  editor.createShape({
    id: createShapeId(),
    type: "text",
    x: 0,
    y: -80 - scene.scale_anchors.length * 22,
    props: {
      richText: toRichText(
        ["SCALE", ...scene.scale_anchors.map((a) => `· ${a}`)].join("\n")
      ),
      color: "grey",
      size: "s",
      font: "mono",
      autoSize: true,
    },
    meta: { source: "scene-translation", label: "scale legend" },
  });
}

export interface CutoutPiece {
  label: string;
  kind: string;
  mobile: boolean;
  /** Blob URL of the transparent PNG cutout */
  url: string;
  /** Crop bbox in reference-image pixel coords */
  bbox: { x: number; y: number; w: number; h: number };
}

/**
 * Cutout mode: place transparent PNG pieces of the actual reference image as
 * movable image shapes, preserving their positions and relative scale.
 */
export async function cutoutsToCanvas(
  editor: Editor,
  opts: {
    pieces: CutoutPiece[];
    imageW: number;
    imageH: number;
    scene: SceneTranslation;
    animate?: boolean;
  }
) {
  const scale = Math.min(STAGE_W / opts.imageW, STAGE_H / opts.imageH);

  // Larger pieces first so they sit behind smaller ones.
  const sorted = [...opts.pieces].sort(
    (a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h
  );

  for (const piece of sorted) {
    const w = Math.max(piece.bbox.w * scale, 12);
    const h = Math.max(piece.bbox.h * scale, 12);
    const assetId = AssetRecordType.createId();
    editor.createAssets([
      {
        id: assetId,
        typeName: "asset",
        type: "image",
        props: {
          name: piece.label,
          src: piece.url,
          w,
          h,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: {},
      },
    ]);
    editor.createShape({
      id: createShapeId(),
      type: "image",
      x: piece.bbox.x * scale,
      y: piece.bbox.y * scale,
      props: { assetId, w, h },
      meta: {
        label: piece.label,
        kind: piece.kind,
        mobile: piece.mobile,
        source: "scene-cutout",
      },
    });
    if (opts.animate !== false) {
      editor.zoomToFit({ animation: { duration: 120 } });
      await new Promise((r) => setTimeout(r, 90));
    }
  }

  addScaleLegend(editor, opts.scene);
  editor.zoomToFit({ animation: { duration: 300 } });
}

/** Upload a blob to Vercel Blob without creating an asset row. */
export async function uploadBlobOnly(
  blob: Blob,
  pathname: string
): Promise<string> {
  const uploaded = await upload(pathname, blob, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
  });
  return uploaded.url;
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
