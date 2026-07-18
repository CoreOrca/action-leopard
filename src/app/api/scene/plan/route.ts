import { NextResponse } from "next/server";
import { chat, extractJson, type ChatContent } from "@/lib/xai";
import { SCENE_PLAN_SYSTEM } from "@/lib/prompts";
import type { PlannedShot, ScenePlan } from "@/lib/types";

export const maxDuration = 300;

interface PlanBody {
  script: string;
  intent?: string;
  artDirection?: string;
  locations: { url: string; label?: string; notes?: string }[];
  elements?: { kind: string; name: string; notes: string }[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as PlanBody;

  if (!body.script?.trim() || !body.locations?.length) {
    return NextResponse.json(
      { error: "script and at least one location image are required" },
      { status: 400 }
    );
  }

  const lines = [
    `SCRIPT:\n${body.script.trim()}`,
    body.intent?.trim() ? `INTENT:\n${body.intent.trim()}` : "",
    body.artDirection?.trim() ? `ART DIRECTION:\n${body.artDirection.trim()}` : "",
    body.elements?.length
      ? `ELEMENTS IN THIS PROJECT:\n${body.elements
          .map((e) => `- [${e.kind}] ${e.name}${e.notes ? ` — ${e.notes}` : ""}`)
          .join("\n")}`
      : "",
    `LOCATION IMAGES: ${body.locations.length} attached below, IN PATH ORDER. Use 0-based location_index to map shots to them.`,
  ].filter(Boolean);

  const content: ChatContent = [{ type: "text", text: lines.join("\n\n") }];
  body.locations.forEach((loc, i) => {
    content.push({
      type: "text",
      text: `LOCATION ${i}${loc.label ? ` — ${loc.label}` : ""}${
        loc.notes ? ` (${loc.notes})` : ""
      }:`,
    });
    content.push({
      type: "image_url",
      image_url: { url: loc.url, detail: "high" },
    });
  });

  const messages = [
    { role: "system" as const, content: SCENE_PLAN_SYSTEM },
    { role: "user" as const, content },
  ];

  try {
    let plan: ScenePlan | null = null;
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      const result = await chat(messages, {
        temperature: 0.3,
        maxTokens: 16384,
      });
      try {
        plan = extractJson<ScenePlan>(result.content ?? "");
      } catch {
        if (attempt === 1) throw new Error("Planner returned unparseable JSON");
      }
    }
    if (!plan?.shots?.length) throw new Error("Planner returned no shots");

    // Clamp location indices so a stray index can never break insertion.
    plan.shots = plan.shots.map((s: PlannedShot, i: number) => ({
      ...s,
      shot_number: i + 1,
      location_index: Math.min(
        Math.max(s.location_index ?? 0, 0),
        body.locations.length - 1
      ),
    }));

    return NextResponse.json({ plan });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
