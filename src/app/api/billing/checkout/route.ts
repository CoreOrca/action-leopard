import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, getPriceId } from "@/lib/stripe";
import { PLANS, type PlanId } from "@/lib/plans";

/** GET /api/billing/checkout?plan=starter — plain-link redirect to Stripe
 *  Checkout (no stripe.js / publishable key needed). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan") as PlanId | null;
  if (!plan || !(plan in PLANS))
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.redirect(new URL("/login", url.origin));

  const stripe = getStripe();
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("billing")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = row?.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from("billing")
      .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: "user_id" });
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: await getPriceId(plan), quantity: 1 }],
    client_reference_id: user.id,
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    success_url: `${site}/api/billing/sync?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/pricing`,
  });

  return NextResponse.redirect(session.url!, { status: 303 });
}
