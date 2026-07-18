import { NextResponse } from "next/server";
import { chat, extractJson, type ChatContent } from "@/lib/xai";
import { ACTION_DIRECTIVES, SHOT_JUDGE_SYSTEM } from "@/lib/prompts";
import type { JudgeVerdict, ShotSpec } from "@/lib/types";

export const maxDuration = 120;

interface JudgeBody {
  shot: {
    title?: string;
    spec: Partial<ShotSpec>;
    version: number;
    promptUsed?: string;
  };
  frameUrl: string;
  locationUrl?: string;
  prevFrameUrl?: string;
  canvasUrl?: string;
  /** The next shot's entry_continuity — where the action must be headed. */
  nextEntry?: string;
  scaleAnchors?: string[];
  artDirection?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as JudgeBody;
  if (!body.frameUrl || !body.shot?.spec) {
    return NextResponse.json(
      { error: "frameUrl and shot.spec are required" },
      { status: 400 }
    );
  }

  const spec = body.shot.spec;
  const directive = spec.directive ? ACTION_DIRECTIVES[spec.directive] : null;
  const system = directive
    ? `${SHOT_JUDGE_SYSTEM}\n\n${directive}`
    : SHOT_JUDGE_SYSTEM;

  const lines = [
    `SHOT${body.shot.title ? ` — ${body.shot.title}` : ""} (frame version ${body.shot.version}):`,
    `SPEC:\n${JSON.stringify(spec, null, 2)}`,
    body.nextEntry
      ? `NEXT SHOT'S ENTRY STATE (the action must be headed here): ${body.nextEntry}`
      : "",
    body.scaleAnchors?.length
      ? `REAL-WORLD SCALE ANCHORS:\n${body.scaleAnchors.map((a) => `- ${a}`).join("\n")}`
      : "",
    body.artDirection?.trim() ? `ART DIRECTION: ${body.artDirection.trim()}` : "",
    body.shot.promptUsed
      ? `PROMPT THAT PRODUCED THE FRAME:\n${body.shot.promptUsed}`
      : "",
  ].filter(Boolean);

  const content: ChatContent = [
    { type: "text", text: lines.join("\n\n") },
    { type: "text", text: "[1] GENERATED FRAME UNDER REVIEW:" },
    { type: "image_url", image_url: { url: body.frameUrl, detail: "high" } },
  ];
  if (body.locationUrl) {
    content.push(
      { type: "text", text: "[2] LOCATION REFERENCE (geography/proportion truth):" },
      { type: "image_url", image_url: { url: body.locationUrl, detail: "high" } }
    );
  }
  if (body.prevFrameUrl) {
    content.push(
      { type: "text", text: "[3] PREVIOUS SHOT'S APPROVED FRAME (world-state continuity truth):" },
      { type: "image_url", image_url: { url: body.prevFrameUrl, detail: "high" } }
    );
  }
  if (body.canvasUrl) {
    content.push(
      { type: "text", text: "[4] CANVAS BLOCKING DIAGRAM (placement only, never sizes):" },
      { type: "image_url", image_url: { url: body.canvasUrl, detail: "high" } }
    );
  }

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content },
  ];

  let verdict: JudgeVerdict | null = null;
  for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
    try {
      const result = await chat(messages, { temperature: 0.2, maxTokens: 4096 });
      verdict = extractJson<JudgeVerdict>(result.content ?? "");
    } catch {
      // retry once; fall through to synthetic verdict after
    }
  }
  if (!verdict) {
    verdict = {
      version: body.shot.version,
      pass: false,
      checks: [],
      summary: "Judge reply was unparseable — treating as a failed review.",
      fix: {
        strategy: "revise-prompt",
        notes:
          "Judge output could not be parsed; rewrite the prompt restating every invariant and scale anchor as hard instructions.",
      },
    };
  }

  verdict.version = body.shot.version;
  verdict.checks = Array.isArray(verdict.checks) ? verdict.checks : [];
  // A fail with zero specific failed checks is a vibes-fail — count it as a pass
  // so it can never burn generation credits.
  if (!verdict.pass && verdict.checks.length > 0 && verdict.checks.every((c) => c.pass)) {
    verdict.pass = true;
  }

  return NextResponse.json({ verdict });
}
