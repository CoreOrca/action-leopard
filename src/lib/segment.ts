"use client";

/**
 * Client-side mask processing for segmentation-based scene modes.
 * - traceMask: binary mask image → simplified silhouette polygon
 * - cutoutFromMask: reference image × mask → cropped transparent PNG
 *
 * SAM 3.1 masks may be hard binary, soft grayscale, or alpha-channel.
 * We auto-detect format, clean holes/speckles, and produce soft-edge cutouts.
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

/** Read mask pixels at optional downscale. Returns RGBA + dims. */
function readMaskPixels(
  bitmap: ImageBitmap,
  maxDim: number
): { rgba: Uint8ClampedArray; w: number; h: number; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h, scale };
}

/**
 * Convert a SAM mask image to a binary occupancy map.
 * Handles white-on-black, soft grayscale, and alpha masks; auto-inverts
 * if the "object" would cover most of the frame (common inverted output).
 */
function maskToBinary(
  bitmap: ImageBitmap,
  maxDim = 640
): { data: Uint8Array; w: number; h: number; scale: number } {
  const { rgba, w, h, scale } = readMaskPixels(bitmap, maxDim);
  const n = w * h;
  const strength = new Float32Array(n);

  let alphaVar = 0;
  let alphaSum = 0;
  for (let i = 0; i < n; i++) {
    alphaSum += rgba[i * 4 + 3];
  }
  const alphaMean = alphaSum / n;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    alphaVar += (a - alphaMean) ** 2;
  }
  alphaVar /= n;
  // Prefer alpha when it actually varies (true alpha mask / cutout).
  const useAlpha = alphaVar > 200;

  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    if (useAlpha) {
      strength[i] = a;
    } else {
      // Grayscale / RGB mask: luminance. Fully transparent → off.
      strength[i] = a < 16 ? 0 : 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  // Otsu-like threshold on the strength histogram (256 bins).
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    hist[Math.min(255, Math.max(0, Math.round(strength[i])))]++;
  }
  let threshold = 127;
  {
    let total = 0;
    let sum = 0;
    for (let t = 0; t < 256; t++) {
      total += hist[t];
      sum += t * hist[t];
    }
    let sumB = 0;
    let wB = 0;
    let maxVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) {
        maxVar = between;
        threshold = t;
      }
    }
    // Floor: soft masks often peak mid-gray; don't go below ~40.
    threshold = Math.max(40, Math.min(200, threshold));
  }

  const bin = new Uint8Array(n);
  let onCount = 0;
  for (let i = 0; i < n; i++) {
    const on = strength[i] >= threshold ? 1 : 0;
    bin[i] = on;
    onCount += on;
  }

  // If "object" is most of the frame, the mask is likely inverted.
  if (onCount > n * 0.55) {
    for (let i = 0; i < n; i++) bin[i] = bin[i] ? 0 : 1;
    onCount = n - onCount;
  }

  // Drop empty / near-empty masks early.
  if (onCount < 16) {
    return { data: bin, w, h, scale };
  }

  cleanMask(bin, w, h);
  return { data: bin, w, h, scale };
}

/** Hole fill + morphological close + drop tiny components. */
function cleanMask(bin: Uint8Array, w: number, h: number) {
  fillHoles(bin, w, h);
  morphClose(bin, w, h, 1);
  keepLargestComponents(bin, w, h, 0.01);
}

/**
 * Flood-fill background from image edges; any remaining 0s are holes → fill.
 */
function fillHoles(bin: Uint8Array, w: number, h: number) {
  const n = w * h;
  const exterior = new Uint8Array(n); // 1 = reachable background from edge
  const stack: number[] = [];

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bin[i] || exterior[i]) return;
    exterior[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }

  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  for (let i = 0; i < n; i++) {
    // Interior background (not exterior, not object) = hole
    if (!bin[i] && !exterior[i]) bin[i] = 1;
  }
}

/** Dilate then erode with a (2r+1) square kernel to close small gaps. */
function morphClose(bin: Uint8Array, w: number, h: number, radius: number) {
  const n = w * h;
  const dil = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && bin[ny * w + nx]) {
            on = 1;
            break outer;
          }
        }
      }
      dil[y * w + x] = on;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !dil[ny * w + nx]) {
            on = 0;
            break outer;
          }
        }
      }
      bin[y * w + x] = on;
    }
  }
}

/**
 * Keep connected components whose area is ≥ minFrac of total object area
 * (or the single largest if everything is tiny). Drops speckles.
 */
function keepLargestComponents(
  bin: Uint8Array,
  w: number,
  h: number,
  minFrac: number
) {
  const n = w * h;
  const labels = new Int32Array(n);
  labels.fill(-1);
  const areas: number[] = [];
  let label = 0;

  for (let i = 0; i < n; i++) {
    if (!bin[i] || labels[i] >= 0) continue;
    // BFS flood
    const q = [i];
    labels[i] = label;
    let area = 0;
    while (q.length) {
      const cur = q.pop()!;
      area++;
      const x = cur % w;
      const y = (cur / w) | 0;
      const neighbors = [cur + 1, cur - 1, cur + w, cur - w];
      for (const nb of neighbors) {
        if (nb < 0 || nb >= n) continue;
        const nx = nb % w;
        // Prevent wrap on horizontal neighbors
        if (Math.abs(nx - x) + Math.abs(((nb / w) | 0) - y) !== 1) continue;
        if (bin[nb] && labels[nb] < 0) {
          labels[nb] = label;
          q.push(nb);
        }
      }
    }
    areas.push(area);
    label++;
  }

  if (label === 0) return;
  const total = areas.reduce((s, a) => s + a, 0);
  const minArea = Math.max(16, total * minFrac);
  let keep = areas.map((a) => a >= minArea);
  if (!keep.some(Boolean)) {
    // Keep only the largest
    const maxIdx = areas.indexOf(Math.max(...areas));
    keep = areas.map((_, i) => i === maxIdx);
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0 && !keep[labels[i]]) bin[i] = 0;
  }
}

/** Moore-neighbor boundary trace of the largest connected mass. */
function traceBoundary(
  bin: Uint8Array,
  w: number,
  h: number
): [number, number][] {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : 0;

  // Prefer starting on the largest component's topmost-left pixel
  const areas = new Map<string, number>();
  // Just scan for first object pixel (cleanMask already kept largest comps)
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
  void areas;

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
 * Soft mask strength 0..1 at full reference resolution.
 * Same format detection as maskToBinary, but preserves edge falloff for
 * anti-aliased cutouts.
 */
function maskStrengthFull(
  mask: ImageBitmap,
  w: number,
  h: number
): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(mask, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const strength = new Float32Array(n);

  let alphaVar = 0;
  let alphaSum = 0;
  for (let i = 0; i < n; i++) alphaSum += rgba[i * 4 + 3];
  const alphaMean = alphaSum / n;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    alphaVar += (a - alphaMean) ** 2;
  }
  alphaVar /= n;
  const useAlpha = alphaVar > 200;

  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    if (useAlpha) {
      strength[i] = a / 255;
    } else {
      strength[i] = a < 16 ? 0 : (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
  }

  // Mean strength — invert if the mask is mostly "on"
  let mean = 0;
  for (let i = 0; i < n; i++) mean += strength[i];
  mean /= n;
  if (mean > 0.55) {
    for (let i = 0; i < n; i++) strength[i] = 1 - strength[i];
  }

  return strength;
}

/**
 * Bilinear sample of a binary mask (0/1) as a float alpha 0..1.
 * Gives smooth sticker edges when the cleanup grid is coarser than the photo.
 */
function sampleBinaryAlpha(
  bin: Uint8Array,
  bw: number,
  bh: number,
  x: number,
  y: number,
  fullW: number,
  fullH: number
): number {
  const fx = ((x + 0.5) / fullW) * bw - 0.5;
  const fy = ((y + 0.5) / fullH) * bh - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (ix: number, iy: number) => {
    if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) return 0;
    return bin[iy * bw + ix];
  };
  const v00 = at(x0, y0);
  const v10 = at(x1, y0);
  const v01 = at(x0, y1);
  const v11 = at(x1, y1);
  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  );
}

/**
 * Composite the reference image with a mask into a tightly-cropped
 * transparent PNG cutout. Returns the blob plus the crop bbox in
 * reference-image pixel coords.
 *
 * Cleanup (hole fill, morph close, drop speckles) runs on a downscaled
 * binary mask; alpha is the bilinear upsample of that binary blended
 * with the original soft mask strength for natural sticker edges.
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

  const { data: bin, w: bw, h: bh } = maskToBinary(mask, 640);
  const soft = maskStrengthFull(mask, w, h);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(ref, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cleaned = sampleBinaryAlpha(bin, bw, bh, x, y, w, h);
      // Gate with cleaned occupancy; refine edge with original soft strength.
      const alphaF = cleaned * Math.max(soft[i], cleaned > 0.5 ? 0.9 : 0);
      if (alphaF < 0.06) {
        img.data[i * 4 + 3] = 0;
        continue;
      }
      const alpha = Math.min(255, Math.round(alphaF * 255));
      img.data[i * 4 + 3] = Math.min(img.data[i * 4 + 3], alpha);
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (count < 16) return null;

  // Pad crop by 2px so soft edges aren't clipped
  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(w - 1, maxX + 2);
  maxY = Math.min(h - 1, maxY + 2);

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

/**
 * Kinds that become movable photo-stickers in cutouts mode.
 * Amorphous backgrounds stay as blocks behind the stickers.
 */
export const STICKER_KINDS = new Set([
  "vehicle",
  "character",
  "prop",
  "set-dressing",
  "other",
]);

/** Kinds always treated as backdrop (never photo-cutouts). */
export const BACKDROP_KINDS = new Set([
  "sky",
  "ground",
  "nature",
  "architecture",
  "location",
]);

export function isStickerObject(obj: {
  kind: string;
  mobile: boolean;
  w: number;
  h: number;
}): boolean {
  if (BACKDROP_KINDS.has(obj.kind)) return false;
  if (STICKER_KINDS.has(obj.kind)) return true;
  // Unknown kinds: stickers if mobile or reasonably small (not a full-frame slab)
  if (obj.mobile) return true;
  return obj.w * obj.h < 0.35;
}
