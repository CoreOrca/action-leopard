"use client";

/**
 * Client-side orchestrator for scene projects: the Builder (plan), and the
 * Manager that runs the generate → judge → fix loop. Runs in the browser so
 * a 12-shot pipeline never fights the serverless duration cap; every state
 * transition persists to the shots table so a refresh resumes cleanly.
 */

import { useWorkspace } from "./store";
import { useSceneAgent, type ScenePhase } from "./scene-store";
import { insertShotsFromPlan, deleteShot } from "./shots";
import type { ScenePlan, Shot } from "./types";

/** Hard cap: auto-fix regenerations per shot before escalating to the user. */
export const MAX_AUTO_FIXES = 2;

/** Shot statuses the run loop owns. */
export const RUNNING_STATUSES: Shot["status"][] = [
  "approved",
  "generating",
  "judging",
  "fixing",
];

/**
 * Parse the project's script into planned shots (the Builder). Replaces any
 * prior still-planned shots; generated shots are left untouched.
 */
export async function planScene(): Promise<void> {
  const { project, elements } = useWorkspace.getState();
  const scene = useSceneAgent.getState();
  if (!project) return;

  scene.setPanelOpen(true);
  if (!project.script?.trim()) {
    scene.pushEvent({
      kind: "error",
      text: "Add a script in the left rail first — the planner parses it into shots.",
    });
    return;
  }
  if (!project.location_map?.length) {
    scene.pushEvent({
      kind: "error",
      text: "Add at least one location image to the location map — it is the path the scene travels.",
    });
    return;
  }

  scene.setPhase("planning");
  scene.pushEvent({
    kind: "info",
    text: `Parsing the script into shots across ${project.location_map.length} location${
      project.location_map.length > 1 ? "s" : ""
    }…`,
  });

  try {
    const res = await fetch("/api/scene/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: project.script,
        intent: project.intent,
        artDirection: project.art_direction,
        locations: project.location_map.map((l) => ({
          url: l.url,
          label: l.label,
          notes: l.notes,
        })),
        elements: elements.map((e) => ({
          kind: e.kind,
          name: e.name,
          notes: e.notes,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "planning failed");
    const plan = data.plan as ScenePlan;

    // Replace prior un-generated plan rows; keep anything already generated.
    const existing = useSceneAgent.getState().shots;
    const stale = existing.filter(
      (s) => s.status === "planned" && !s.start_asset_id
    );
    await Promise.all(stale.map((s) => deleteShot(s.id)));
    const kept = existing.filter((s) => !stale.some((x) => x.id === s.id));

    const inserted = await insertShotsFromPlan(
      project.id,
      plan,
      project.location_map
    );
    scene.setShots([...kept, ...inserted]);

    for (const p of plan.shots) {
      scene.pushEvent({
        kind: "plan",
        text: `Shot ${p.shot_number} — ${p.title}: ${p.spec.description}`,
      });
    }
    scene.pushEvent({
      kind: "info",
      text: `Planned ${plan.shots.length} shots. Review the plan, then generate start frames.`,
    });
    scene.setPhase("awaiting-approval");
  } catch (e) {
    scene.pushEvent({ kind: "error", text: (e as Error).message });
    scene.setPhase("idle");
  }
}

/** Derive the loop phase from persisted shot statuses (resume after refresh). */
export function computeResume(shots: Shot[]): {
  phase: ScenePhase;
  pendingShotIds: string[];
} {
  const pending = shots.filter((s) => RUNNING_STATUSES.includes(s.status));
  if (pending.length)
    return { phase: "paused", pendingShotIds: pending.map((s) => s.id) };
  if (shots.some((s) => s.status === "planned"))
    return { phase: "awaiting-approval", pendingShotIds: [] };
  if (shots.some((s) => s.status === "escalated"))
    return { phase: "paused", pendingShotIds: [] };
  if (
    shots.length &&
    shots.every((s) => ["passed", "accepted"].includes(s.status))
  )
    return { phase: "done", pendingShotIds: [] };
  return { phase: "idle", pendingShotIds: [] };
}
