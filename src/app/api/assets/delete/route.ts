import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: asset } = await supabase
    .from("assets")
    .select("id, url, user_id, project_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    if (asset.url.includes(".blob.vercel-storage.com")) {
      await del(asset.url);
    }
  } catch {
    // Blob may already be gone; still remove the row.
  }
  await supabase.from("assets").delete().eq("id", id);

  // Clear dangling references — a deleted blob URL left in an element or the
  // location map becomes an unreachable generator input (fal 422s on it).
  await supabase
    .from("elements")
    .update({ image_url: null })
    .eq("user_id", user.id)
    .eq("image_url", asset.url);
  const { data: proj } = await supabase
    .from("projects")
    .select("id, reference_image_url, location_map")
    .eq("id", asset.project_id)
    .maybeSingle();
  if (proj) {
    const patch: Record<string, unknown> = {};
    if (proj.reference_image_url === asset.url) patch.reference_image_url = null;
    const lm = (proj.location_map ?? []) as { asset_id?: string; url?: string }[];
    const kept = lm.filter((l) => l.asset_id !== asset.id && l.url !== asset.url);
    if (kept.length !== lm.length) patch.location_map = kept;
    if (Object.keys(patch).length)
      await supabase.from("projects").update(patch).eq("id", proj.id);
  }
  return NextResponse.json({ ok: true });
}
