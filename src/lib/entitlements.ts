import type Stripe from "stripe";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { PLANS, PLAN_BY_LOOKUP_KEY, type PlanId } from "./plans";

/** Thrown when a request would exceed the user's plan; routes map it to 402. */
export class EntitlementError extends Error {
  readonly isEntitlement = true;
}

export interface Entitlement {
  plan: PlanId | "comp" | "none";
  entitled: boolean;
  /** No metering (allowlisted/comp accounts) */
  unlimited: boolean;
  credits: number;
  used: number;
  status: string;
  periodStart: string;
  periodEnd: string | null;
}

function allowlist(): string[] {
  return (process.env.ACCESS_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

function calendarMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Current user's plan + credit position. Allowlisted emails get unmetered
 *  comp access (demo users, founders) without any Stripe state. */
export async function getEntitlement(): Promise<Entitlement> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new EntitlementError("Not signed in");

  if (user.email && allowlist().includes(user.email.toLowerCase())) {
    return {
      plan: "comp",
      entitled: true,
      unlimited: true,
      credits: 0,
      used: 0,
      status: "comp",
      periodStart: calendarMonthStart(),
      periodEnd: null,
    };
  }

  const { data: row } = await supabase
    .from("billing")
    .select("plan, status, period_start, period_end")
    .maybeSingle();

  const planId = row?.plan as PlanId | undefined;
  const entitled =
    !!planId && planId in PLANS && ENTITLED_STATUSES.has(row?.status ?? "");
  if (!entitled) {
    return {
      plan: "none",
      entitled: false,
      unlimited: false,
      credits: 0,
      used: 0,
      status: row?.status ?? "none",
      periodStart: calendarMonthStart(),
      periodEnd: null,
    };
  }

  const periodStart = row?.period_start ?? calendarMonthStart();
  const { data: used } = await supabase.rpc("usage_total", {
    p_start: periodStart,
  });

  return {
    plan: planId!,
    entitled: true,
    unlimited: false,
    credits: PLANS[planId!].credits,
    used: Number(used ?? 0),
    status: row!.status,
    periodStart,
    periodEnd: row?.period_end ?? null,
  };
}

/** Gate a spend of `cost` credits; throws EntitlementError when not allowed. */
export async function assertCredits(cost: number): Promise<void> {
  const ent = await getEntitlement();
  if (ent.unlimited) return;
  if (!ent.entitled)
    throw new EntitlementError(
      "No active subscription — choose a plan at /pricing to generate."
    );
  if (ent.used + cost > ent.credits)
    throw new EntitlementError(
      `Out of credits — this needs ${cost} but ${ent.credits - ent.used} of ${ent.credits} remain this period. Upgrade at /pricing or wait for renewal.`
    );
}

/** Record spent credits after a successful generation. Comp accounts skip. */
export async function recordUsage(
  kind: "image" | "video" | "segment",
  model: string,
  credits: number,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (user.email && allowlist().includes(user.email.toLowerCase())) return;
  await supabase.from("usage_events").insert({
    user_id: user.id,
    kind,
    model,
    credits,
    metadata,
  });
}

/** Map a Stripe subscription onto the user's billing row (webhook + sync). */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.user_id;
  if (!userId) return;

  const item = sub.items?.data?.[0];
  const lookupKey = item?.price?.lookup_key ?? "";
  const plan = PLAN_BY_LOOKUP_KEY[lookupKey] ?? "none";
  const toIso = (secs: number | null | undefined) =>
    secs ? new Date(secs * 1000).toISOString() : null;

  const admin = createAdminClient();
  const { error } = await admin.from("billing").upsert(
    {
      user_id: userId,
      stripe_customer_id:
        typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      plan,
      status: sub.status,
      period_start: toIso(item?.current_period_start),
      period_end: toIso(item?.current_period_end),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(`billing upsert failed: ${error.message}`);
}
