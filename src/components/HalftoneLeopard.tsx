"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight procedural halftone leopard for the landing page.
 * Foreground dots on background (theme-aware). No images, no deps.
 *
 * Coordinate space for the SDF: x right, y up. Head faces +x.
 * Canvas maps v=0 (top) → +y so the animal stands upright.
 */

type Dot = {
  x: number;
  y: number;
  r: number;
  phase: number;
  /** 0 body / 1 head / 2 front legs / 3 back legs / 4 tail */
  part: number;
};

/** Smooth union of two SDFs. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Ellipse SDF centered at (cx,cy), radii (rx,ry). */
function ellipse(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): number {
  const x = (px - cx) / rx;
  const y = (py - cy) / ry;
  return Math.hypot(x, y) - 1;
}

/**
 * Stalking leopard in profile, facing right.
 * Proportions closer to a real big-cat walk: long body, low head,
 * stacked legs, ear on crown, tail curling up from the rump.
 */
function leopardSDF(px: number, py: number, t: number): number {
  const walk = Math.sin(t * 2.1) * 0.022;
  const walk2 = Math.sin(t * 2.1 + Math.PI) * 0.022;

  // Torso — long horizontal mass (belly slightly lower)
  let d = ellipse(px, py, 0.02, 0.02, 0.62, 0.22);
  // Shoulder / withers
  d = smin(d, ellipse(px, py, 0.28, 0.08, 0.28, 0.2), 0.12);
  // Hip / rump
  d = smin(d, ellipse(px, py, -0.38, 0.06, 0.28, 0.2), 0.12);
  // Chest deeper under shoulders
  d = smin(d, ellipse(px, py, 0.32, -0.06, 0.22, 0.16), 0.1);

  // Neck
  d = smin(d, ellipse(px, py, 0.52, 0.1, 0.16, 0.12), 0.08);

  // Head
  d = smin(d, ellipse(px, py, 0.72, 0.12, 0.18, 0.15), 0.06);
  // Muzzle / snout pointing forward
  d = smin(d, ellipse(px, py, 0.9, 0.06, 0.12, 0.08), 0.05);
  // Lower jaw
  d = smin(d, ellipse(px, py, 0.84, 0.0, 0.1, 0.06), 0.04);
  // Ear (upright, slightly back on skull)
  d = smin(d, ellipse(px, py, 0.68, 0.3, 0.06, 0.09), 0.03);
  // Small second ear suggestion (far side)
  d = smin(d, ellipse(px, py, 0.62, 0.26, 0.045, 0.06), 0.02);

  // Front legs (under chest) — opposite walk phases
  d = smin(
    d,
    ellipse(px, py, 0.3, -0.28 - walk, 0.065, 0.2),
    0.05
  );
  d = smin(
    d,
    ellipse(px, py, 0.16, -0.26 + walk, 0.055, 0.18),
    0.05
  );
  // Front paws
  d = smin(d, ellipse(px, py, 0.3, -0.46 - walk, 0.07, 0.04), 0.03);
  d = smin(d, ellipse(px, py, 0.16, -0.44 + walk, 0.06, 0.035), 0.03);

  // Hind legs (under hips)
  d = smin(
    d,
    ellipse(px, py, -0.32, -0.26 + walk2, 0.075, 0.2),
    0.05
  );
  d = smin(
    d,
    ellipse(px, py, -0.48, -0.24 - walk2, 0.065, 0.18),
    0.05
  );
  // Hind paws
  d = smin(d, ellipse(px, py, -0.32, -0.44 + walk2, 0.075, 0.04), 0.03);
  d = smin(d, ellipse(px, py, -0.48, -0.42 - walk2, 0.065, 0.035), 0.03);

  // Tail — arcs up and back from rump (classic cat S-curve)
  d = smin(d, ellipse(px, py, -0.62, 0.1, 0.1, 0.07), 0.06);
  d = smin(d, ellipse(px, py, -0.78, 0.22, 0.1, 0.07), 0.05);
  d = smin(d, ellipse(px, py, -0.88, 0.38, 0.08, 0.07), 0.04);
  d = smin(d, ellipse(px, py, -0.82, 0.52, 0.07, 0.06), 0.03);

  return d;
}

function partAt(px: number, py: number): number {
  if (px > 0.55) return 1; // head
  if (px < -0.58 && py > 0.05) return 4; // tail
  if (py < -0.12 && px > 0.05) return 2; // front legs
  if (py < -0.12 && px <= 0.05) return 3; // back legs
  return 0;
}

function buildDots(cols: number, rows: number): Dot[] {
  const dots: Dot[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Hex-ish stagger like print halftone
      const u = (i + 0.5 + (j % 2) * 0.35) / cols;
      const v = (j + 0.5) / rows;
      // Canvas top (v=0) → +y (upright animal)
      const px = (u - 0.5) * 2.35;
      const py = (0.5 - v) * 1.55;
      const d = leopardSDF(px, py, 0);
      if (d > 0.02) continue;

      const depth = Math.min(1, Math.max(0, -d / 0.28));
      const hash = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      const jitter = hash - Math.floor(hash);
      // Slightly tighter size range so silhouette edges read cleaner
      const r = 0.28 + depth * 0.5 + jitter * 0.16;

      dots.push({
        x: u,
        y: v,
        r,
        phase: jitter * Math.PI * 2,
        part: partAt(px, py),
      });
    }
  }
  return dots;
}

export default function HalftoneLeopard({
  className = "",
}: {
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Slightly denser grid for cleaner silhouette
    const COLS = 56;
    const ROWS = 34;
    dotsRef.current = buildDots(COLS, ROWS);

    let raf = 0;
    let running = true;
    let start = performance.now();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const isDark = () =>
      document.documentElement.classList.contains("dark");

    const draw = (now: number) => {
      if (!running) return;
      resize();
      const w = canvas.width;
      const h = canvas.height;
      const t = (now - start) / 1000;

      const fill = isDark() ? "#f5f5f5" : "#0a0a0a";

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fill;

      const prowlX = Math.sin(t * 0.7) * 0.01 * w;
      const prowlY = Math.sin(t * 1.1) * 0.005 * h;

      const entrance = Math.min(1, t / 1.2);
      const ease = entrance * entrance * (3 - 2 * entrance);

      const cell = Math.min(w / COLS, h / ROWS);

      for (const dot of dotsRef.current) {
        let partPulse = 0;
        if (dot.part === 2) partPulse = Math.sin(t * 2.1) * 0.1;
        else if (dot.part === 3) partPulse = Math.sin(t * 2.1 + Math.PI) * 0.1;
        else if (dot.part === 4)
          partPulse = Math.sin(t * 1.4 + dot.phase) * 0.07;
        else partPulse = Math.sin(t * 1.6 + dot.phase) * 0.03;

        const breath = 1 + partPulse;
        const r = dot.r * cell * 0.52 * breath * ease;
        if (r < 0.25) continue;

        ctx.beginPath();
        ctx.arc(dot.x * w + prowlX, dot.y * h + prowlY, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          running = true;
          raf = requestAnimationFrame(draw);
        } else {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.05 }
    );
    io.observe(canvas);

    const mo = new MutationObserver(() => {});
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
