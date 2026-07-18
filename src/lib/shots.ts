"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  LocationMapEntry,
  PlannedShot,
  ScenePlan,
  Shot,
} from "@/lib/types";

/** All shots for a project, in sequence order. */
export async function listShots(projectId: string): Promise<Shot[]> {
  const { data } = await createClient()
    .from("shots")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("created_at");
  return (data as Shot[]) ?? [];
}

/** Insert the planner's shots, replacing any prior un-generated plan rows. */
export async function insertShotsFromPlan(
  projectId: string,
  plan: ScenePlan,
  locationMap: LocationMapEntry[]
): Promise<Shot[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const rows = plan.shots.map((p: PlannedShot, i: number) => ({
    project_id: projectId,
    user_id: user.id,
    kind: "shot" as const,
    sort_order: i + 1,
    title: p.title,
    script_excerpt: p.script_excerpt,
    spec: p.spec,
    location_asset_id:
      locationMap[p.location_index]?.asset_id ?? locationMap[0]?.asset_id ?? null,
    prompts: { image_a: p.image_a_prompt },
    status: "planned" as const,
  }));

  const { data, error } = await supabase.from("shots").insert(rows).select();
  if (error) throw new Error(error.message);
  return (data as Shot[]) ?? [];
}

export async function insertShot(
  projectId: string,
  partial: Partial<Shot>
): Promise<Shot> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("shots")
    .insert({ project_id: projectId, user_id: user.id, ...partial })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Shot;
}

export async function patchShot(
  id: string,
  patch: Partial<Shot>
): Promise<void> {
  const { error } = await createClient()
    .from("shots")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteShot(id: string): Promise<void> {
  await createClient().from("shots").delete().eq("id", id);
}

/** Rewrite sort_order to match the given id order (1-based). */
export async function reorderShots(orderedIds: string[]): Promise<void> {
  const supabase = createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("shots").update({ sort_order: i + 1 }).eq("id", id)
    )
  );
}
