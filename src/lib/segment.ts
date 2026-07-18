"use client";

/**
 * Client-side mask processing for segmentation-based scene modes.
 * - traceMask: binary mask → simplified silhouette polygon
 * - cutoutFromMask: reference × SAM mask → transparent PNG sticker
 * - cutoutsFromAtlas: flat color map × reference → stickers by color key
 *
 * SAM masks may be hard binary, soft grayscale, or alpha-channel.
 * Cleanup + distance-field feather produce smooth sticker edges.
 */

export interface TracedMask {
  polygon: [number, number][];
  bbox: { x: number; y: number; w: number; h: number };
  imageW: number;
  imageH: number;
}

export interface AtlasLegendEntry {
  id: string;
  label: string;
  kind: string;
  mobile: boolean;
  /** RGB 0–255 assigned in the atlas generation prompt */
  r: number;
  g: number;
  b: number;
}

export interface CutoutResult {
  blob: Blob;
  bbox: { x: number; y: number; w: number; h: number };
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return createImageBitmap(await res.blob());
}

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
 * if the "object" would cover most of the frame.
 */
function maskToBinary(
  bitmap: ImageBitmap,
  maxDim = 1280
): { data: Uint8Array; w: number; h: number; scale: number } {
  const { rgba, w, h, scale } = readMaskPixels(bitmap, maxDim);
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
      strength[i] = a;
    } else {
      strength[i] = a < 16 ? 0 : 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

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
    threshold = Math.max(40, Math.min(200, threshold));
  }

  const bin = new Uint8Array(n);
  let onCount = 0;
  for (let i = 0; i < n; i++) {
    const on = strength[i] >= threshold ? 1 : 0;
    bin[i] = on;
    onCount += on;
  }

  if (onCount > n * 0.55) {
    for (let i = 0; i < n; i++) bin[i] = bin[i] ? 0 : 1;
    onCount = n - onCount;
  }

  if (onCount < 16) return { data: bin, w, h, scale };

  cleanMask(bin, w, h);
  return { data: bin, w, h, scale };
}

function cleanMask(bin: Uint8Array, w: number, h: number) {
  fillHoles(bin, w, h);
  morphClose(bin, w, h, 1);
  keepLargestComponents(bin, w, h, 0.008);
}

function fillHoles(bin: Uint8Array, w: number, h: number) {
  const n = w * h;
  const exterior = new Uint8Array(n);
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
    if (!bin[i] && !exterior[i]) bin[i] = 1;
  }
}

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
    const maxIdx = areas.indexOf(Math.max(...areas));
    keep = areas.map((_, i) => i === maxIdx);
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0 && !keep[labels[i]]) bin[i] = 0;
  }
}

/**
 * Chamfer distance from each object pixel to the nearest background.
 * Used for smoothstep edge feathering (smoother than bilinear binary).
 */
function distanceToBackground(
  bin: Uint8Array,
  w: number,
  h: number
): Float32Array {
  const n = w * h;
  const dist = new Float32Array(n);
  const INF = 1e6;
  for (let i = 0; i < n; i++) dist[i] = bin[i] ? INF : 0;

  // Forward
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0)
        dist[i] = Math.min(dist[i], dist[i - w + 1] + 1.414);
    }
  }
  // Backward
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!bin[i]) continue;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
      if (x < w - 1 && y < h - 1)
        dist[i] = Math.min(dist[i], dist[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1)
        dist[i] = Math.min(dist[i], dist[i + w - 1] + 1.414);
    }
  }
  return dist;
}

/** Smoothstep 0..1 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}

/**
 * Binary → soft alpha via distance field. Interior solid, ~featherPx soft edge.
 */
function binaryToFeatheredAlpha(
  bin: Uint8Array,
  w: number,
  h: number,
  featherPx: number
): Float32Array {
  const dist = distanceToBackground(bin, w, h);
  const alpha = new Float32Array(w * h);
  const f = Math.max(1.5, featherPx);
  for (let i = 0; i < w * h; i++) {
    if (!bin[i]) {
      alpha[i] = 0;
      continue;
    }
    // Ramp from 0 at boundary to 1 by feather distance inward
    alpha[i] = smoothstep(0.5, f, dist[i]);
  }
  return alpha;
}

function sampleAlpha(
  alpha: Float32Array,
  aw: number,
  ah: number,
  x: number,
  y: number,
  fullW: number,
  fullH: number
): number {
  const fx = ((x + 0.5) / fullW) * aw - 0.5;
  const fy = ((y + 0.5) / fullH) * ah - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (ix: number, iy: number) => {
    if (ix < 0 || iy < 0 || ix >= aw || iy >= ah) return 0;
    return alpha[iy * aw + ix];
  };
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x1, y0) * tx * (1 - ty) +
    at(x0, y1) * (1 - tx) * ty +
    at(x1, y1) * tx * ty
  );
}

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

  let mean = 0;
  for (let i = 0; i < n; i++) mean += strength[i];
  mean /= n;
  if (mean > 0.55) {
    for (let i = 0; i < n; i++) strength[i] = 1 - strength[i];
  }
  return strength;
}

function traceBoundary(
  bin: Uint8Array,
  w: number,
  h: number
): [number, number][] {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : 0;

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
  let dir = 6;
  const maxSteps = w * h * 4;

  for (let step = 0; step < maxSteps; step++) {
    contour.push([cx, cy]);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8;
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
    if (!found) break;
    if (cx === sx && cy === sy && contour.length > 2) break;
  }
  return contour;
}

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

/** Mild Chaikin corner-cut for smoother silhouettes without losing extent. */
function chaikin(
  points: [number, number][],
  iterations = 1
): [number, number][] {
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    if (pts.length < 3) return pts;
    const next: [number, number][] = [];
    const n = pts.length;
    // Open chain treatment: keep ends, cut middles (closed loop assumed)
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    pts = next;
  }
  return pts;
}

export async function traceMask(maskUrl: string): Promise<TracedMask | null> {
  const bitmap = await loadBitmap(maskUrl);
  // Higher res for tighter silhouettes
  const { data, w, h, scale } = maskToBinary(bitmap, 1280);

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
  // Less aggressive RDP → more precise traces
  const eps = Math.max(0.75, Math.max(maxX - minX, maxY - minY) / 140);
  let poly = simplify(contour, eps);
  if (poly.length >= 6) poly = chaikin(poly, 1);
  const mapped = poly.map(
    ([x, y]) => [x / scale, y / scale] as [number, number]
  );

  return {
    polygon: mapped,
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
 * Composite reference × mask → tightly-cropped transparent PNG.
 * Distance-field feather at high cleanup res for smooth sticker edges.
 */
export async function cutoutFromMask(
  referenceUrl: string,
  maskUrl: string
): Promise<CutoutResult | null> {
  const [ref, mask] = await Promise.all([
    loadBitmap(referenceUrl),
    loadBitmap(maskUrl),
  ]);

  const w = ref.width;
  const h = ref.height;

  const { data: bin, w: bw, h: bh } = maskToBinary(mask, 1280);
  // Feather ~2.5px at cleanup res, scales visually with image
  const feather = Math.max(2, Math.round(Math.min(bw, bh) * 0.004));
  const feathered = binaryToFeatheredAlpha(bin, bw, bh, feather);
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
      const featherA = sampleAlpha(feathered, bw, bh, x, y, w, h);
      // Prefer distance-field alpha; lift interior with soft mask slightly
      const alphaF =
        featherA > 0.5
          ? Math.max(featherA, Math.min(1, soft[i] * 0.15 + featherA * 0.85))
          : featherA;
      if (alphaF < 0.04) {
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
 * Extract stickers from a flat-color Scene Atlas + the original photo.
 * Each legend color keys a region; matched pixels pull photo content.
 */
export async function cutoutsFromAtlas(
  referenceUrl: string,
  atlasUrl: string,
  legend: AtlasLegendEntry[],
  colorTolerance = 48
): Promise<
  {
    id: string;
    label: string;
    kind: string;
    mobile: boolean;
    blob: Blob;
    bbox: { x: number; y: number; w: number; h: number };
  }[]
> {
  const [ref, atlas] = await Promise.all([
    loadBitmap(referenceUrl),
    loadBitmap(atlasUrl),
  ]);
  const w = ref.width;
  const h = ref.height;

  const aCanvas = document.createElement("canvas");
  aCanvas.width = w;
  aCanvas.height = h;
  const aCtx = aCanvas.getContext("2d", { willReadFrequently: true })!;
  aCtx.drawImage(atlas, 0, 0, w, h);
  const atlasData = aCtx.getImageData(0, 0, w, h).data;

  const rCanvas = document.createElement("canvas");
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext("2d", { willReadFrequently: true })!;
  rCtx.drawImage(ref, 0, 0, w, h);

  const results: {
    id: string;
    label: string;
    kind: string;
    mobile: boolean;
    blob: Blob;
    bbox: { x: number; y: number; w: number; h: number };
  }[] = [];

  const tol2 = colorTolerance * colorTolerance;

  for (const entry of legend) {
    const bin = new Uint8Array(w * h);
    let count = 0;
    for (let i = 0; i < w * h; i++) {
      const dr = atlasData[i * 4] - entry.r;
      const dg = atlasData[i * 4 + 1] - entry.g;
      const db = atlasData[i * 4 + 2] - entry.b;
      if (dr * dr + dg * dg + db * db <= tol2) {
        bin[i] = 1;
        count++;
      }
    }
    if (count < 64) continue;

    cleanMask(bin, w, h);
    // Recount after cleanup
    count = 0;
    for (let i = 0; i < w * h; i++) if (bin[i]) count++;
    if (count < 64) continue;

    const feather = Math.max(2, Math.round(Math.min(w, h) * 0.0025));
    const alphaMap = binaryToFeatheredAlpha(bin, w, h, feather);

    rCtx.drawImage(ref, 0, 0, w, h);
    const img = rCtx.getImageData(0, 0, w, h);

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let on = 0;
    for (let i = 0; i < w * h; i++) {
      const a = alphaMap[i];
      if (a < 0.04) {
        img.data[i * 4 + 3] = 0;
        continue;
      }
      img.data[i * 4 + 3] = Math.min(
        img.data[i * 4 + 3],
        Math.round(a * 255)
      );
      on++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (on < 64) continue;

    minX = Math.max(0, minX - 2);
    minY = Math.max(0, minY - 2);
    maxX = Math.min(w - 1, maxX + 2);
    maxY = Math.min(h - 1, maxY + 2);

    rCtx.putImageData(img, 0, 0);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const crop = document.createElement("canvas");
    crop.width = cw;
    crop.height = ch;
    crop.getContext("2d")!.drawImage(rCanvas, minX, minY, cw, ch, 0, 0, cw, ch);
    const blob = await new Promise<Blob | null>((resolve) =>
      crop.toBlob(resolve, "image/png")
    );
    if (!blob) continue;
    results.push({
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      mobile: entry.mobile,
      blob,
      bbox: { x: minX, y: minY, w: cw, h: ch },
    });
  }

  return results;
}

/** Fixed high-contrast palette for Scene Atlas color keys (max ~24 objects). */
export const ATLAS_PALETTE: [number, number, number][] = [
  [231, 76, 60],
  [52, 152, 219],
  [46, 204, 113],
  [155, 89, 182],
  [241, 196, 15],
  [230, 126, 34],
  [26, 188, 156],
  [52, 73, 94],
  [192, 57, 43],
  [41, 128, 185],
  [39, 174, 96],
  [142, 68, 173],
  [243, 156, 18],
  [211, 84, 0],
  [22, 160, 133],
  [127, 140, 141],
  [44, 62, 80],
  [22, 160, 133],
  [189, 195, 199],
  [149, 165, 166],
  [250, 128, 114],
  [100, 149, 237],
  [60, 179, 113],
  [255, 105, 180],
];

export function assignAtlasColors(
  objects: { id: string; label: string; kind: string; mobile: boolean }[]
): AtlasLegendEntry[] {
  return objects.map((o, i) => {
    const [r, g, b] = ATLAS_PALETTE[i % ATLAS_PALETTE.length];
    return { id: o.id, label: o.label, kind: o.kind, mobile: o.mobile, r, g, b };
  });
}

// ── Scene packaging: what becomes a sticker vs continuous stage ──────────

/** Always continuous environment — never photo-stickers. */
export const CONTINUOUS_KINDS = new Set(["sky", "ground"]);

/**
 * True for discrete playable pieces: vehicles, people, props, and
 * structural architecture (towers, skybridges, walkways). Continuous
 * sky / ground / large water / far skyline stay as plate or blocks.
 */
export function isStickerObject(obj: {
  kind: string;
  mobile: boolean;
  w: number;
  h: number;
  label?: string;
}): boolean {
  const kind = obj.kind;
  const area = obj.w * obj.h;
  const label = (obj.label ?? "").toLowerCase();

  if (kind === "sky") return false;
  if (kind === "ground" && area > 0.12) return false;

  // Continuous environment by label (even if mis-kinded)
  if (
    /^(overcast\s+)?sky\b|^ocean\b|^sea\b|^river\b|^water\b|^horizon\b/.test(
      label
    )
  ) {
    return false;
  }
  if (
    area > 0.18 &&
    /(skyline|far[- ]?bank|distant\s+(city|coast|hills)|wide\s+river)/.test(
      label
    )
  ) {
    return false;
  }

  if (
    kind === "vehicle" ||
    kind === "character" ||
    kind === "prop" ||
    kind === "set-dressing"
  ) {
    return true;
  }
  if (obj.mobile) return true;

  // Architecture / location: discrete structures are stickers (Chongqing towers,
  // skybridges, walkways). Full-frame slabs stay backdrop.
  if (kind === "architecture" || kind === "location") {
    return area < 0.55;
  }

  // Nature: small rocks/trees yes; large hills/embankments no
  if (kind === "nature") {
    return area < 0.22;
  }

  if (kind === "other") return area < 0.4;
  return area < 0.35;
}

/** Scene has cars/people/props worth removing for an empty plate. */
export function hasMobileSubjects(
  objects: { kind: string; mobile: boolean }[]
): boolean {
  return objects.some(
    (o) =>
      o.mobile ||
      o.kind === "vehicle" ||
      o.kind === "character" ||
      o.kind === "prop"
  );
}

/** Location-heavy (many structures) → prefer cinematic atlas. */
export function isLocationHeavy(
  objects: { kind: string; w: number; h: number }[]
): boolean {
  const arch = objects.filter(
    (o) => o.kind === "architecture" || o.kind === "location"
  );
  return arch.length >= 3 || arch.some((o) => o.w * o.h > 0.15);
}
