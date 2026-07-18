"use client";

/**
 * Client-side mask processing for segmentation-based scene modes.
 * - traceMask: binary mask image → simplified silhouette polygon
 * - cutoutFromMask: reference image × mask → transparent PNG cutout
 */

export interface TracedMask {
  /** Polygon in mask-image pixel coords */
  polygon: [number, number][];
  /** Tight bbox of the mask in pixel coords */
  bbox: { x: number; y: number; w: number; h: number };
  imageW: number;
  imageH: number;
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return createImageBitmap(await res.blob());
}

function maskToBinary(
  bitmap: ImageBitmap,
  maxDim = 640
): { data: Uint8Array; w: number; h: number; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = img[i * 4];
    const g = img[i * 4 + 1];
    const b = img[i * 4 + 2];
    const a = img[i * 4 + 3];
    // White-ish and opaque = object
    bin[i] = a > 127 && r + g + b > 380 ? 1 : 0;
  }
  return { data: bin, w, h, scale };
}

/** Moore-neighbor boundary trace of the largest connected mass. */
function traceBoundary(
  bin: Uint8Array,
  w: number,
  h: number
): [number, number][] {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : 0;

  // Find a starting boundary pixel (first object pixel scanning row-major)
  let sx = -1;
  let sy = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y)) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }
  if (sx < 0) return [];

  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const contour: [number, number][] = [];
  let cx = sx;
  let cy = sy;
  let dir = 6; // came from below
  const maxSteps = w * h * 4;

  for (let step = 0; step < maxSteps; step++) {
    contour.push([cx, cy]);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8; // start looking backwards-left
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (at(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    if (cx === sx && cy === sy && contour.length > 2) break;
  }
  return contour;
}

/** Ramer-Douglas-Peucker simplification. */
function simplify(
  points: [number, number][],
  epsilon: number
): [number, number][] {
  if (points.length < 3) return points;
  const dmax = { d: 0, i: 0 };
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const d =
      Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / len;
    if (d > dmax.d) {
      dmax.d = d;
      dmax.i = i;
    }
  }
  if (dmax.d > epsilon) {
    const left = simplify(points.slice(0, dmax.i + 1), epsilon);
    const right = simplify(points.slice(dmax.i), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

export async function traceMask(maskUrl: string): Promise<TracedMask | null> {
  const bitmap = await loadBitmap(maskUrl);
  const { data, w, h, scale } = maskToBinary(bitmap);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x]) {
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 16) return null;

  const contour = traceBoundary(data, w, h);
  if (contour.length < 8) return null;
  const eps = Math.max(1.5, Math.max(maxX - minX, maxY - minY) / 80);
  const poly = simplify(contour, eps).map(
    ([x, y]) => [x / scale, y / scale] as [number, number]
  );

  return {
    polygon: poly,
    bbox: {
      x: minX / scale,
      y: minY / scale,
      w: (maxX - minX + 1) / scale,
      h: (maxY - minY + 1) / scale,
    },
    imageW: bitmap.width,
    imageH: bitmap.height,
  };
}

/**
 * Composite the reference image with a mask into a tightly-cropped
 * transparent PNG cutout. Returns the blob plus the crop bbox in
 * reference-image pixel coords.
 */
export async function cutoutFromMask(
  referenceUrl: string,
  maskUrl: string
): Promise<{ blob: Blob; bbox: { x: number; y: number; w: number; h: number } } | null> {
  const [ref, mask] = await Promise.all([
    loadBitmap(referenceUrl),
    loadBitmap(maskUrl),
  ]);

  const w = ref.width;
  const h = ref.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  ctx.drawImage(mask, 0, 0, w, h);
  const maskData = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(ref, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    const on =
      maskData[i * 4 + 3] > 127 &&
      maskData[i * 4] + maskData[i * 4 + 1] + maskData[i * 4 + 2] > 380;
    if (on) {
      count++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      img.data[i * 4 + 3] = 0;
    }
  }
  if (count < 16) return null;

  ctx.putImageData(img, 0, 0);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const crop = document.createElement("canvas");
  crop.width = cw;
  crop.height = ch;
  crop.getContext("2d")!.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);

  const blob = await new Promise<Blob | null>((resolve) =>
    crop.toBlob(resolve, "image/png")
  );
  if (!blob) return null;
  return { blob, bbox: { x: minX, y: minY, w: cw, h: ch } };
}
