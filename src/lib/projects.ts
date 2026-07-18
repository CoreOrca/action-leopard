"use client";

import { createClient } from "@/lib/supabase/client";
import type { Asset, Element, Project, ProjectType } from "@/lib/types";

/** Create a project of the given type; returns its id, or null on failure. */
export async function createNewProject(
  type: ProjectType
): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: type === "scene" ? "Untitled scene" : "Untitled project",
      project_type: type,
    })
    .select()
    .single();
  if (error || !data) return null;
  return data.id as string;
}

export async function setProjectArchived(
  id: string,
  archived: boolean
): Promise<void> {
  await createClient().from("projects").update({ archived }).eq("id", id);
}

/**
 * Copy a project's INPUTS as a fresh project for fast iteration: intent,
 * script, art direction, models, elements, and the reference/art-direction
 * assets (rows pointing at the same blobs — no media is re-uploaded). Shots,
 * generated frames, and clips are not copied.
 */
export async function duplicateProject(id: string): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: p }, { data: els }, { data: assets }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("elements").select("*").eq("project_id", id).order("created_at"),
    supabase
      .from("assets")
      .select("*")
      .eq("project_id", id)
      .in("type", ["reference", "art-direction"])
      .order("sort_order"),
  ]);
  const src = p as Project | null;
  if (!src) return null;

  const { data: created, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: `${src.name} copy`,
      project_type: src.project_type,
      intent: src.intent,
      art_direction: src.art_direction,
      script: src.script,
      image_model: src.image_model,
      video_model: src.video_model,
      reference_image_url: src.reference_image_url,
    })
    .select()
    .single();
  if (error || !created) return null;
  const newId = created.id as string;

  // Elements first, tracking old → new ids for asset metadata remapping.
  const elementIdMap = new Map<string, string>();
  for (const el of (els as Element[]) ?? []) {
    const { data: ne } = await supabase
      .from("elements")
      .insert({
        project_id: newId,
        user_id: user.id,
        kind: el.kind,
        name: el.name,
        notes: el.notes,
        image_url: el.image_url,
      })
      .select()
      .single();
    if (ne) elementIdMap.set(el.id, ne.id as string);
  }

  // Reference/art-direction asset rows (same blob URLs), remapping ids.
  const assetIdMap = new Map<string, string>();
  let sort = 0;
  for (const a of (assets as Asset[]) ?? []) {
    const meta = { ...a.metadata };
    if (typeof meta.element_id === "string")
      meta.element_id = elementIdMap.get(meta.element_id) ?? meta.element_id;
    const { data: na } = await supabase
      .from("assets")
      .insert({
        project_id: newId,
        user_id: user.id,
        type: a.type,
        url: a.url,
        thumbnail_url: a.thumbnail_url,
        prompt: a.prompt,
        model: a.model,
        metadata: meta,
        sort_order: ++sort,
      })
      .select()
      .single();
    if (na) assetIdMap.set(a.id, na.id as string);
  }

  // Location map keeps its order and URLs; asset ids point at the copies.
  if (src.location_map?.length) {
    const location_map = src.location_map.map((l) => ({
      ...l,
      asset_id: assetIdMap.get(l.asset_id) ?? l.asset_id,
    }));
    await supabase.from("projects").update({ location_map }).eq("id", newId);
  }

  return newId;
}
