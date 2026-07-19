import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { applySubscription } from "@/lib/entitlements";

/** GET /api/billing/sync?session_id=… — Checkout success return. Applies the
 *  subscription immediately (no webhook lag) then lands in the studio. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });
      if (
        session.client_reference_id === user.id &&
        session.subscription &&
        typeof session.subscription !== "string"
      ) {
        await applySubscription(session.subscription as Stripe.Subscription);
      }
    } catch (err) {
      console.error("billing sync failed", err);
    }
  }
  return NextResponse.redirect(new URL("/studio", url.origin), { status: 303 });
}
