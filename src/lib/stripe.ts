import Stripe from "stripe";
import { PLANS, type PlanId } from "./plans";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key?.startsWith("sk_"))
      throw new Error("STRIPE_SECRET_KEY is missing or not a secret (sk_) key");
    client = new Stripe(key);
  }
  return client;
}

const priceIdCache = new Map<PlanId, string>();

/** Resolve a plan's Stripe price id by lookup key (no env price ids needed). */
export async function getPriceId(plan: PlanId): Promise<string> {
  const cached = priceIdCache.get(plan);
  if (cached) return cached;
  const { data } = await getStripe().prices.list({
    lookup_keys: [PLANS[plan].lookupKey],
    active: true,
    limit: 1,
  });
  const price = data[0];
  if (!price)
    throw new Error(
      `No active Stripe price for ${PLANS[plan].lookupKey} — run node scripts/stripe-setup.mjs`
    );
  priceIdCache.set(plan, price.id);
  return price.id;
}
