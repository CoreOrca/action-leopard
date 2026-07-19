// One-time (idempotent) Stripe bootstrap: products + monthly prices by lookup
// key, plus the production webhook endpoint. Run: node scripts/stripe-setup.mjs
import Stripe from "stripe";
import { readFileSync, writeFileSync } from "node:fs";

const envPath = new URL("../.env.local", import.meta.url);
const env = readFileSync(envPath, "utf8");
const get = (name) => env.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, "m"))?.[1];

const key = get("STRIPE_SECRET_KEY");
if (!key?.startsWith("sk_")) throw new Error("STRIPE_SECRET_KEY missing or not an sk_ key");
const stripe = new Stripe(key);

const PLANS = [
  { lookupKey: "al_starter_monthly", name: "Action Leopard Starter", amount: 1999 },
  { lookupKey: "al_creator_monthly", name: "Action Leopard Creator", amount: 9900 },
  { lookupKey: "al_pro_monthly", name: "Action Leopard Pro", amount: 29900 },
];

for (const plan of PLANS) {
  const existing = await stripe.prices.list({ lookup_keys: [plan.lookupKey], active: true });
  if (existing.data.length) {
    console.log(`✓ ${plan.lookupKey} exists → ${existing.data[0].id}`);
    continue;
  }
  const product = await stripe.products.create({ name: plan.name });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amount,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: plan.lookupKey,
  });
  console.log(`+ created ${plan.name} → ${price.id} ($${plan.amount / 100}/mo)`);
}

const webhookUrl = "https://actionleopard.com/api/stripe/webhook";
const events = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
let hook = hooks.data.find((h) => h.url === webhookUrl);
if (hook) {
  console.log(`✓ webhook endpoint exists → ${hook.id} (secret not retrievable after creation)`);
} else {
  hook = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: events });
  console.log(`+ created webhook endpoint ${hook.id}`);
  if (hook.secret) {
    const updated = env.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, `STRIPE_WEBHOOK_SECRET="${hook.secret}"`);
    writeFileSync(envPath, updated);
    console.log(`  secret written to .env.local — copy STRIPE_WEBHOOK_SECRET to Vercel env vars`);
  }
}
