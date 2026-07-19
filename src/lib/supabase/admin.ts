import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Service-key client for server-only writes that bypass RLS (billing rows
 *  from Stripe webhooks/sync). Never import from client components. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
