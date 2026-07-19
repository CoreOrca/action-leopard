/** Subscription plans + credit costs. Pure config — safe to import anywhere.
 *
 *  Credit costs are calibrated against real per-call COGS (fal/xAI/Anthropic,
 *  July 2026) so every tier keeps a ~70% gross margin even at full burn:
 *  a credit's underlying cost lands around $0.04–0.05 typical, and each tier
 *  sells credits at $0.15–0.20. Image cost absorbs the scene-loop judge/fix
 *  LLM overhead; LLM-only calls (plan, judge, chat, prompts) are not metered.
 */

export type PlanId = "starter" | "creator" | "pro";

export interface PlanDef {
  id: PlanId;
  label: string;
  priceUsd: number;
  /** Credits included per monthly period */
  credits: number;
  /** Stripe price lookup_key (created by scripts/stripe-setup.mjs) */
  lookupKey: string;
  blurb: string;
}

export const PLANS: Record<PlanId, PlanDef> = {
  starter: {
    id: "starter",
    label: "Starter",
    priceUsd: 19.99,
    credits: 100,
    lookupKey: "al_starter_monthly",
    blurb: "Try the workflow. Roughly 20 frames or a handful of clips a month.",
  },
  creator: {
    id: "creator",
    label: "Creator",
    priceUsd: 99,
    credits: 600,
    lookupKey: "al_creator_monthly",
    blurb: "Working shots. Enough for full scene runs with room to iterate.",
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceUsd: 299,
    credits: 2000,
    lookupKey: "al_pro_monthly",
    blurb: "Production volume. Multiple scenes, end frames and video passes.",
  },
};

export const PLAN_BY_LOOKUP_KEY: Record<string, PlanId> = Object.fromEntries(
  Object.values(PLANS).map((p) => [p.lookupKey, p.id])
) as Record<string, PlanId>;

/** Credits per generated image (any image model; includes judge/fix overhead). */
export const IMAGE_CREDITS = 5;

/** Credits per segmentation pass (up to 24 SAM calls). */
export const SEGMENT_CREDITS = 4;

/** Credits per 5 seconds of video, by video model id. */
const VIDEO_CREDITS_PER_5S: Record<string, number> = {
  "grok-imagine-1.5-480p": 10,
  "grok-imagine-1.5-720p": 16,
  "grok-imagine-1.5-1080p": 28,
  "kling-3-pro": 14,
  "kling-3-pro-motion": 14,
  "seedance-2": 32,
  "seedance-2-fast": 26,
};

export function videoCredits(modelId: string, duration?: number): number {
  const per5s = VIDEO_CREDITS_PER_5S[modelId] ?? 16;
  const blocks = Math.max(1, Math.ceil((duration ?? 5) / 5));
  return per5s * blocks;
}
