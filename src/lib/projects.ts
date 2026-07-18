"use client";

import { createClient } from "@/lib/supabase/client";
import type { ProjectType } from "@/lib/types";

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
