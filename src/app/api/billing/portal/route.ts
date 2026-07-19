import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

/** GET /api/billing/portal — plain-link redirect to the Stripe billing
 *  portal (change plan, update card, cancel). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const { data: row } = await supabase
    .from("billing")
    .select("stripe_customer_id")
    .maybeSingle();
  if (!row?.stripe_customer_id)
    return NextResponse.redirect(new URL("/pricing", url.origin));

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const session = await getStripe().billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: `${site}/pricing`,
  });
  return NextResponse.redirect(session.url, { status: 303 });
}
