import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEntitlement, type Entitlement } from "@/lib/entitlements";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let ent: Entitlement | null = null;
  if (user) {
    try {
      ent = await getEntitlement();
    } catch {
      ent = null;
    }
  }

  const plans = Object.values(PLANS);

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center px-6 py-16">
      <h1 className="font-mono text-lg tracking-widest">ACTION LEOPARD</h1>
      <p className="mt-1 font-mono text-xs text-muted">
        spatial control for generated action
      </p>

      {ent?.plan === "comp" && (
        <div className="mt-10 w-full max-w-3xl border border-border p-4 font-mono text-xs">
          Complimentary access — no subscription needed.{" "}
          <Link href="/studio" className="underline underline-offset-4">
            Enter the studio →
          </Link>
        </div>
      )}
      {ent && ent.entitled && ent.plan !== "comp" && (
        <div className="mt-10 w-full max-w-3xl border border-border p-4 font-mono text-xs flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="uppercase tracking-wider">
            Current plan: {PLANS[ent.plan as keyof typeof PLANS].label}
          </span>
          <span className="text-muted">
            {ent.credits - ent.used} of {ent.credits} credits left this period
          </span>
          <span className="ml-auto flex gap-4">
            <Link href="/studio" className="underline underline-offset-4">
              Studio →
            </Link>
            <a href="/api/billing/portal" className="underline underline-offset-4">
              Manage billing
            </a>
          </span>
        </div>
      )}

      <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-px border border-border bg-border-soft sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = ent?.plan === plan.id && ent?.entitled;
          return (
            <div key={plan.id} className="flex flex-col bg-background p-6">
              <h2 className="font-mono text-xs uppercase tracking-widest">
                {plan.label}
              </h2>
              <p className="mt-4 text-2xl font-mono">
                ${plan.priceUsd}
                <span className="text-xs text-muted"> /mo</span>
              </p>
              <p className="mt-2 font-mono text-xs">
                {plan.credits.toLocaleString()} credits / month
              </p>
              <p className="mt-3 text-xs text-muted leading-relaxed">
                {plan.blurb}
              </p>
              <div className="mt-auto pt-6">
                {isCurrent ? (
                  <span className="block border border-border-soft px-4 py-2 text-center font-mono text-xs uppercase tracking-widest text-muted">
                    Current plan
                  </span>
                ) : user ? (
                  <a
                    href={`/api/billing/checkout?plan=${plan.id}`}
                    className="block border border-foreground px-4 py-2 text-center font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
                  >
                    Subscribe
                  </a>
                ) : (
                  <Link
                    href="/login"
                    className="block border border-foreground px-4 py-2 text-center font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
                  >
                    Sign in to subscribe
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-8 max-w-3xl font-mono text-[11px] text-muted leading-relaxed">
        A credit is our unit of generation: a frame costs 5, a segmentation
        pass 4, and a video clip 10–32 per 5 seconds depending on the model.
        Unused credits do not roll over. Questions —{" "}
        <a href="mailto:support@actionleopard.com" className="underline underline-offset-4">
          support@actionleopard.com
        </a>
      </p>
    </main>
  );
}
