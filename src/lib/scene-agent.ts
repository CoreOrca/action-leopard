"use client";

/**
 * Client-side orchestrator for scene projects: the Builder (plan), and the
 * Manager that runs the generate → judge → fix loop. Runs in the browser so
 * a 12-shot pipeline never fights the serverless duration cap; every state
 * transition persists to the shots table so a refresh resumes cleanly.
 */

import { createClient } from "./supabase/client";
import { useWorkspace } from "./store";
import { useSceneAgent, type ScenePhase } from "./scene-store";
import { insertShotsFromPlan, deleteShot, patchShot } from "./shots";
import { getImageModel, getVideoModel } from "./models";
import { shotIntent } from "./shot-scope";
import type {
  Asset,
  JudgeVerdict,
  Project,
  ScenePlan,
  Shot,
  ShotSpec,
} from "./types";

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

/* ---------------------------------------------------------------------------
 * The run loop (the Manager): generate → judge → fix, hard-capped, persisted.
 * Shots are processed strictly in sequence so each shot's continuity input is
 * its predecessor's JUDGE-APPROVED frame, never a broken one.
 * ------------------------------------------------------------------------- */

type InputChip = { key: string; url: string; role: string };

const getShot = (id: string) =>
  useSceneAgent.getState().shots.find((s) => s.id === id);

const shotLabel = (id: string) => {
  const shots = useSceneAgent.getState().shots;
  const i = shots.findIndex((s) => s.id === id);
  return `Shot ${i + 1}`;
};

async function persistShot(id: string, patch: Partial<Shot>) {
  useSceneAgent.getState().patchShotLocal(id, patch);
  await patchShot(id, patch);
}

const assetById = (id: string | null) =>
  id ? useWorkspace.getState().assets.find((a) => a.id === id) ?? null : null;

/** The judge-approved frame of the nearest earlier shot, for continuity. */
function prevApprovedFrameUrl(shotId: string): string | null {
  const shots = useSceneAgent.getState().shots;
  const i = shots.findIndex((s) => s.id === shotId);
  for (let j = i - 1; j >= 0; j--) {
    const prev = shots[j];
    if (["passed", "accepted"].includes(prev.status) && prev.start_asset_id) {
      const a = assetById(prev.start_asset_id);
      if (a) return a.url;
    }
  }
  return null;
}

/** Default generation inputs for a shot, priority-ordered, with role keys. */
function buildInputs(
  project: Project,
  shot: Shot,
  overrides: { add: Set<string>; remove: Set<string> }
): InputChip[] {
  const { elements, assets } = useWorkspace.getState();
  const list: InputChip[] = [];

  const loc =
    project.location_map?.find((l) => l.asset_id === shot.location_asset_id) ??
    project.location_map?.[0];
  if (loc) list.push({ key: "location", url: loc.url, role: "location reference photo — geography, architecture and light truth" });

  const prevUrl = prevApprovedFrameUrl(shot.id);
  if (prevUrl)
    list.push({
      key: "prev-shot-frame",
      url: prevUrl,
      role: "previous shot's approved frame — world-state continuity reference only, not composition",
    });

  for (const el of elements) {
    if (el.image_url)
      list.push({
        key: `element:${el.name}`,
        url: el.image_url,
        role: `element reference — ${el.kind}: ${el.name}`,
      });
  }

  assets
    .filter((a) => a.type === "art-direction" && !a.metadata?.element_id)
    .slice(0, 2)
    .forEach((a, i) =>
      list.push({
        key: "art-direction",
        url: a.url,
        role: `art direction reference ${i + 1} (style/grade only)`,
      })
    );

  const filtered = list.filter((c) => !overrides.remove.has(c.key));
  const model = getImageModel(project.image_model);
  return filtered.slice(0, model.maxImages);
}

/** Insert a fake "generated" asset for dry runs (no fal spend): reuses the location image. */
async function insertDryRunAsset(
  project: Project,
  shot: Shot,
  url: string,
  version: number
): Promise<Asset> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const assets = useWorkspace.getState().assets;
  const sortOrder = assets.reduce((m, a) => Math.max(m, a.sort_order), 0) + 1;
  const { data, error } = await supabase
    .from("assets")
    .insert({
      project_id: project.id,
      user_id: user.id,
      type: "image",
      url,
      prompt: shot.prompts.image_a ?? "",
      model: "dry-run",
      sort_order: sortOrder,
      metadata: { shot_id: shot.id, shot_role: "start", version, dry_run: true },
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Asset;
}

async function generateFrame(
  project: Project,
  shotId: string,
  overrides: { add: Set<string>; remove: Set<string> },
  dryRun: boolean
): Promise<void> {
  const scene = useSceneAgent.getState();
  const shot = getShot(shotId);
  if (!shot) return;
  const version = shot.revision_count + 1;

  // Resume reconcile: if a refresh interrupted a generation that actually
  // completed server-side, adopt that frame instead of paying for another.
  if (shot.status === "generating") {
    const existing = useWorkspace
      .getState()
      .assets.find(
        (a) =>
          a.metadata?.shot_id === shot.id &&
          a.metadata?.shot_role === "start" &&
          a.metadata?.version === version
      );
    if (existing) {
      scene.pushEvent({
        kind: "gen",
        shotId,
        text: `${shotLabel(shotId)}: adopted the frame from the interrupted run (v${version}).`,
        imageUrl: existing.url,
      });
      await persistShot(shotId, {
        start_asset_id: existing.id,
        status: "judging",
      });
      return;
    }
  }

  await persistShot(shotId, { status: "generating" });
  const inputs = buildInputs(project, shot, overrides);
  if (!inputs.length) throw new Error(`${shotLabel(shotId)}: no input images available`);
  if (!shot.prompts.image_a?.trim())
    throw new Error(`${shotLabel(shotId)}: no frame A prompt`);

  scene.pushEvent({
    kind: "gen",
    shotId,
    text: `${shotLabel(shotId)}: generating start frame v${version}${dryRun ? " (dry run — no credits)" : ""}…`,
  });

  let asset: Asset;
  if (dryRun) {
    asset = await insertDryRunAsset(project, shot, inputs[0].url, version);
  } else {
    const res = await fetch("/api/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        prompt: shot.prompts.image_a,
        imageUrls: inputs.map((i) => i.url),
        modelId: project.image_model,
        aspectRatio: "16:9",
        metadata: { shot_id: shot.id, shot_role: "start", version },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "generation failed");
    asset = data.assets[0];
  }
  useWorkspace.getState().addAssets([asset]);
  scene.pushEvent({
    kind: "gen",
    shotId,
    text: `${shotLabel(shotId)}: frame v${version} ready.`,
    imageUrl: asset.url,
  });
  await persistShot(shotId, { start_asset_id: asset.id, status: "judging" });
}

async function judgeFrame(
  project: Project,
  shotId: string
): Promise<JudgeVerdict> {
  const scene = useSceneAgent.getState();
  const shot = getShot(shotId);
  if (!shot) throw new Error("shot vanished");
  const frame = assetById(shot.start_asset_id);
  if (!frame) throw new Error(`${shotLabel(shotId)}: no frame to judge`);
  const spec = shot.spec as Partial<ShotSpec>;

  const shots = useSceneAgent.getState().shots;
  const idx = shots.findIndex((s) => s.id === shotId);
  const next = shots[idx + 1];
  const loc =
    project.location_map?.find((l) => l.asset_id === shot.location_asset_id) ??
    project.location_map?.[0];

  scene.pushEvent({
    kind: "verdict",
    shotId,
    text: `${shotLabel(shotId)}: reviewing v${shot.revision_count + 1} against the location and continuity…`,
  });

  const res = await fetch("/api/scene/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shot: {
        title: shot.title,
        spec,
        version: shot.revision_count + 1,
        promptUsed: shot.prompts.image_a,
      },
      frameUrl: frame.url,
      locationUrl: loc?.url,
      prevFrameUrl: prevApprovedFrameUrl(shotId),
      nextEntry: (next?.spec as Partial<ShotSpec> | undefined)?.entry_continuity,
      scaleAnchors: spec.scale_anchors,
      artDirection: project.art_direction,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "judge failed");
  const verdict = data.verdict as JudgeVerdict;

  const history = [...(shot.judge?.history ?? []), verdict];
  await persistShot(shotId, { judge: { last: verdict, history } });
  return verdict;
}

async function fixPrompt(
  project: Project,
  shotId: string,
  verdict: JudgeVerdict,
  overrides: { add: Set<string>; remove: Set<string> }
): Promise<void> {
  const scene = useSceneAgent.getState();
  const shot = getShot(shotId);
  if (!shot) return;
  const spec = shot.spec as Partial<ShotSpec>;

  // Apply deterministic input changes the judge asked for.
  if (verdict.fix?.strategy === "change-inputs") {
    for (const k of verdict.fix.inputs?.add ?? []) overrides.remove.delete(k);
    for (const k of verdict.fix.inputs?.remove ?? []) overrides.remove.add(k);
  }

  await persistShot(shotId, { status: "fixing" });
  scene.pushEvent({
    kind: "fix",
    shotId,
    text: `${shotLabel(shotId)}: rewriting the prompt (${verdict.checks
      .filter((c) => !c.pass)
      .map((c) => c.id)
      .join(", ")})…`,
  });

  const res = await fetch("/api/scene/fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      spec,
      verdict,
      currentPrompt: shot.prompts.image_a ?? "",
      imageRoles: buildInputs(project, shot, overrides).map((i) => ({
        url: i.url,
        role: i.role,
      })),
      artDirection: project.art_direction,
      scaleAnchors: spec.scale_anchors,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "fix failed");

  await persistShot(shotId, {
    prompts: { ...shot.prompts, image_a: data.prompt },
    revision_count: shot.revision_count + 1,
    status: "approved",
  });
}

/** Run one shot to a terminal state: passed, accepted, or escalated. */
async function processShot(
  project: Project,
  shotId: string,
  dryRun: boolean
): Promise<void> {
  const scene = useSceneAgent.getState();
  const overrides = { add: new Set<string>(), remove: new Set<string>() };

  // Safety bound: gen+judge+fix cycles can never exceed the fix cap; the
  // counter guards against a stuck status ping-ponging forever.
  for (let step = 0; step < (MAX_AUTO_FIXES + 2) * 3; step++) {
    const shot = getShot(shotId);
    if (!shot) return;
    if (["passed", "accepted", "escalated", "planned"].includes(shot.status))
      return;

    if (["approved", "fixing", "generating"].includes(shot.status)) {
      await generateFrame(project, shotId, overrides, dryRun);
      continue;
    }

    if (shot.status === "judging") {
      const verdict = await judgeFrame(project, shotId);
      if (verdict.pass) {
        await persistShot(shotId, { status: "passed" });
        scene.pushEvent({
          kind: "verdict",
          shotId,
          text: `${shotLabel(shotId)}: ✓ passed all checks.`,
        });
        return;
      }
      const failed = verdict.checks.filter((c) => !c.pass);
      scene.pushEvent({
        kind: "verdict",
        shotId,
        text: `${shotLabel(shotId)}: ✗ ${verdict.summary} (${failed
          .map((c) => c.id)
          .join(", ")})`,
      });

      const needsHuman =
        verdict.fix?.strategy === "canvas-blocking" ||
        shot.revision_count >= MAX_AUTO_FIXES;
      if (needsHuman) {
        await persistShot(shotId, { status: "escalated" });
        scene.pushEvent({
          kind: "escalate",
          shotId,
          text: `${shotLabel(shotId)}: needs you — ${
            verdict.fix?.strategy === "canvas-blocking"
              ? "the judge says only a blocking diagram will fix placement (open it in fix-it)"
              : `${MAX_AUTO_FIXES} auto-fixes exhausted`
          }.`,
        });
        return;
      }
      await fixPrompt(project, shotId, verdict, overrides);
      continue;
    }
    return; // unknown status — bail rather than loop
  }
}

/**
 * Approve and run shots through the generate → judge → fix loop.
 * Strictly sequential in sort order; every transition is persisted.
 */
export async function runScene(
  opts: { shotIds?: string[]; dryRun?: boolean } = {}
): Promise<void> {
  const { project } = useWorkspace.getState();
  const scene = useSceneAgent.getState();
  if (!project) return;
  if (useSceneAgent.getState().phase === "running") return;

  scene.setPanelOpen(true);
  scene.setPhase("running");

  const eligible = useSceneAgent
    .getState()
    .shots.filter(
      (s) =>
        (!opts.shotIds || opts.shotIds.includes(s.id)) &&
        (s.status === "planned" || RUNNING_STATUSES.includes(s.status))
    );

  if (!eligible.length) {
    scene.pushEvent({ kind: "info", text: "Nothing to run." });
    scene.setPhase(computeResume(useSceneAgent.getState().shots).phase);
    return;
  }

  try {
    for (const s of eligible.filter((s) => s.status === "planned"))
      await persistShot(s.id, { status: "approved" });

    for (const s of eligible) {
      await processShot(project, s.id, !!opts.dryRun);
    }

    const shots = useSceneAgent.getState().shots;
    const escalated = shots.filter((s) => s.status === "escalated");
    if (escalated.length) {
      scene.pushEvent({
        kind: "info",
        text: `Run finished — ${escalated.length} shot${
          escalated.length > 1 ? "s" : ""
        } need${escalated.length > 1 ? "" : "s"} your call above.`,
      });
      scene.setPhase("paused");
    } else {
      scene.pushEvent({
        kind: "info",
        text: "Run finished — every shot passed review.",
      });
      scene.setPhase("done");
    }
  } catch (e) {
    scene.pushEvent({ kind: "error", text: (e as Error).message });
    scene.setPhase(computeResume(useSceneAgent.getState().shots).phase);
  }
}

/**
 * Generate clips for every finished shot that has no video yet, in sequence
 * order. Writes the video prompt first (via /api/prompt/write) when a shot
 * doesn't have one. Confirms the credit spend before starting.
 */
export async function makeVideos(): Promise<void> {
  const { project } = useWorkspace.getState();
  const scene = useSceneAgent.getState();
  if (!project) return;
  if (useSceneAgent.getState().phase === "running") return;

  const eligible = useSceneAgent
    .getState()
    .shots.filter(
      (s) =>
        !s.video_asset_id &&
        s.start_asset_id &&
        (["passed", "accepted"].includes(s.status) || s.kind === "transition")
    );

  scene.setPanelOpen(true);
  if (!eligible.length) {
    scene.pushEvent({
      kind: "info",
      text: "No shots are ready for video — shots need a passed or accepted start frame first.",
    });
    return;
  }

  const model = getVideoModel(project.video_model);
  if (
    !confirm(
      `Generate ${eligible.length} video clip${eligible.length > 1 ? "s" : ""} with ${model.label}? This spends fal credits.`
    )
  )
    return;

  scene.setPhase("running");
  try {
    for (const s of eligible) {
      const shot = getShot(s.id);
      if (!shot) continue;
      const start = assetById(shot.start_asset_id);
      if (!start) continue;
      const end = assetById(shot.end_asset_id);

      let prompt = shot.prompts.video ?? "";
      if (!prompt.trim()) {
        scene.pushEvent({
          kind: "info",
          shotId: shot.id,
          text: `${shotLabel(shot.id)}: writing the video prompt…`,
        });
        const spec = shot.spec as Partial<ShotSpec>;
        const res = await fetch("/api/prompt/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "video",
            intent: shotIntent(project.intent, shot),
            artDirection: project.art_direction,
            imageUrls: [
              { url: start.url, role: "start frame (A)" },
              ...(end ? [{ url: end.url, role: "end frame (B)" }] : []),
            ],
            frameAPrompt: shot.prompts.image_a ?? "",
            videoModel: project.video_model,
            seconds: 5,
            sceneMeta: { scale_anchors: spec.scale_anchors },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "video prompt failed");
        prompt = data.prompt;
        await persistShot(shot.id, {
          prompts: { ...shot.prompts, video: prompt },
        });
      }

      scene.pushEvent({
        kind: "gen",
        shotId: shot.id,
        text: `${shotLabel(shot.id)}: rendering clip (${model.label})…`,
      });
      const version =
        useWorkspace
          .getState()
          .assets.filter(
            (a) =>
              a.metadata?.shot_id === shot.id &&
              a.metadata?.shot_role === "video"
          ).length + 1;
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          prompt,
          modelId: project.video_model,
          startImageUrl: start.url,
          endImageUrl:
            model.supportsEndFrame && end ? end.url : undefined,
          duration: 5,
          metadata: { shot_id: shot.id, shot_role: "video", version },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "video generation failed");
      useWorkspace.getState().addAssets([data.asset]);
      await persistShot(shot.id, { video_asset_id: data.asset.id });
      scene.pushEvent({
        kind: "gen",
        shotId: shot.id,
        text: `${shotLabel(shot.id)}: clip ready.`,
        imageUrl: data.asset.thumbnail_url ?? start.url,
      });
    }
    scene.pushEvent({ kind: "info", text: "Video pass finished." });
  } catch (e) {
    scene.pushEvent({ kind: "error", text: (e as Error).message });
  } finally {
    scene.setPhase(computeResume(useSceneAgent.getState().shots).phase);
  }
}

/** Escalation: user grants a fresh fix budget and reruns one shot. */
export async function retryShot(shotId: string): Promise<void> {
  await persistShot(shotId, { status: "approved", revision_count: 0 });
  await runScene({ shotIds: [shotId] });
}

/** Escalation: user keeps the current frame as-is. */
export async function acceptShot(shotId: string): Promise<void> {
  await persistShot(shotId, { status: "accepted" });
  const scene = useSceneAgent.getState();
  scene.pushEvent({
    kind: "info",
    shotId,
    text: `${shotLabel(shotId)}: accepted as-is.`,
  });
  scene.setPhase(computeResume(useSceneAgent.getState().shots).phase);
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
