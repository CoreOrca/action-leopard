"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight procedural halftone leopard for the landing page.
 * Foreground dots on background (theme-aware). No images, no deps.
 */

type Dot = {
  x: number;
  y: number;
  r: number;
  phase: number;
  /** 0 body / 1 head / 2 front legs / 3 back legs / 4 tail */
  part: number;
};

/** Approximate SDF: negative = inside leopard silhouette (profile, facing right). */
function leopardSDF(px: number, py: number, t: number): number {
  // Normalized space roughly [-1.1, 1.1] x [-0.7, 0.7]
  // Subtle walk cycle offsets
  const walk = Math.sin(t * 2.1) * 0.018;
  const walk2 = Math.sin(t * 2.1 + Math.PI) * 0.018;

  // Body (elongated ellipse)
  const bx = (px + 0.05) / 0.72;
  const by = (py + 0.02) / 0.28;
  const body = Math.hypot(bx, by) - 1;

  // Chest / shoulder mass
  const cx = (px + 0.28) / 0.32;
  const cy = (py + 0.04) / 0.26;
  const chest = Math.hypot(cx, cy) - 1;

  // Head
  const hx = (px - 0.58) / 0.22;
  const hy = (py + 0.06) / 0.2;
  const head = Math.hypot(hx, hy) - 1;

  // Snout
  const sx = (px - 0.78) / 0.12;
  const sy = (py + 0.1) / 0.1;
  const snout = Math.hypot(sx, sy) - 1;

  // Ear
  const ex = (px - 0.55) / 0.07;
  const ey = (py + 0.28) / 0.1;
  const ear = Math.hypot(ex, ey) - 1;

  // Front legs (with walk)
  const fl1x = (px - 0.22) / 0.08;
  const fl1y = (py - 0.32 - walk) / 0.22;
  const frontLeg1 = Math.hypot(fl1x, fl1y) - 1;
  const fl2x = (px - 0.08) / 0.07;
  const fl2y = (py - 0.3 + walk) / 0.2;
  const frontLeg2 = Math.hypot(fl2x, fl2y) - 1;

  // Back legs
  const bl1x = (px + 0.38) / 0.09;
  const bl1y = (py - 0.3 + walk2) / 0.22;
  const backLeg1 = Math.hypot(bl1x, bl1y) - 1;
  const bl2x = (px + 0.52) / 0.08;
  const bl2y = (py - 0.28 - walk2) / 0.2;
  const backLeg2 = Math.hypot(bl2x, bl2y) - 1;

  // Tail (curve of circles)
  const tailA = Math.hypot((px + 0.85) / 0.1, (py + 0.05) / 0.08) - 1;
  const tailB = Math.hypot((px + 0.98) / 0.09, (py + 0.18) / 0.09) - 1;
  const tailC = Math.hypot((px + 1.05) / 0.07, (py + 0.32) / 0.08) - 1;

  // Smooth min of parts
  let d = body;
  d = Math.min(d, chest);
  d = Math.min(d, head);
  d = Math.min(d, snout);
  d = Math.min(d, ear);
  d = Math.min(d, frontLeg1, frontLeg2);
  d = Math.min(d, backLeg1, backLeg2);
  d = Math.min(d, tailA, tailB, tailC);
  return d;
}

function partAt(px: number, py: number): number {
  if (px > 0.4) return 1; // head
  if (px < -0.65) return 4; // tail
  if (py < -0.15 && px > -0.15) return 2; // front legs
  if (py < -0.15 && px <= -0.15) return 3; // back legs
  return 0;
}

function buildDots(cols: number, rows: number): Dot[] {
  const dots: Dot[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Stagger rows slightly like print halftone
      const u = (i + 0.5 + (j % 2) * 0.35) / cols;
      const v = (j + 0.5) / rows;
      // Map to silhouette space
      const px = (u - 0.5) * 2.4;
      const py = (0.5 - v) * 1.45;
      const d = leopardSDF(px, py, 0);
      if (d > 0.04) continue;

      // Larger dots deeper inside the form (classic halftone weight)
      const depth = Math.min(1, Math.max(0, -d / 0.35));
      const hash = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      const jitter = hash - Math.floor(hash);
      const r = 0.22 + depth * 0.55 + jitter * 0.2;

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

    // Dense enough to read as form, sparse enough to stay cheap
    dotsRef.current = buildDots(48, 28);

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

      // Theme: dots = foreground, clear = transparent over page bg
      const fill = isDark() ? "#f5f5f5" : "#0a0a0a";

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fill;

      // Soft prowl: whole form drifts slightly
      const prowlX = Math.sin(t * 0.7) * 0.012 * w;
      const prowlY = Math.sin(t * 1.1) * 0.006 * h;

      // Entrance: grow dots over first ~1.2s
      const entrance = Math.min(1, t / 1.2);
      const ease = entrance * entrance * (3 - 2 * entrance);

      const cell = Math.min(w / 48, h / 28);

      for (const dot of dotsRef.current) {
        // Walk: legs pulse opposite phase
        let partPulse = 0;
        if (dot.part === 2) partPulse = Math.sin(t * 2.1) * 0.12;
        else if (dot.part === 3) partPulse = Math.sin(t * 2.1 + Math.PI) * 0.12;
        else if (dot.part === 4) partPulse = Math.sin(t * 1.4 + dot.phase) * 0.08;
        else partPulse = Math.sin(t * 1.6 + dot.phase) * 0.04;

        const breath = 1 + partPulse;
        const r = dot.r * cell * 0.55 * breath * ease;
        if (r < 0.3) continue;

        const x = dot.x * w + prowlX;
        const y = dot.y * h + prowlY;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    // Pause when off-screen
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          running = true;
          start = performance.now() - (performance.now() - start);
          raf = requestAnimationFrame(draw);
        } else {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.05 }
    );
    io.observe(canvas);

    // Theme changes
    const mo = new MutationObserver(() => {
      /* next frame picks up isDark() */
    });
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
