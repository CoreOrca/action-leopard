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
    .select("id, url, user_id")
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
  return NextResponse.json({ ok: true });
}
