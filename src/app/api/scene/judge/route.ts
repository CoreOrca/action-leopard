import { NextResponse } from "next/server";
import { extractJson, type ChatContent } from "@/lib/xai";
import { reviewChat } from "@/lib/anthropic";
import { ACTION_DIRECTIVES, SHOT_JUDGE_SYSTEM } from "@/lib/prompts";
import type { JudgeVerdict, ShotSpec } from "@/lib/types";

export const maxDuration = 120;

/** Strict schema for the verdict — structured outputs guarantee valid JSON. */
const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observed", "pass", "checks", "summary", "fix"],
  properties: {
    observed: { type: "string" },
    pass: { type: "boolean" },
    summary: { type: "string" },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "pass"],
        properties: {
          id: {
            type: "string",
            enum: [
              "location-fidelity",
              "scale-proportion",
              "screen-direction",
              "continuity-adjacent",
              "anatomy",
              "script-intent",
              "art-direction",
            ],
          },
          pass: { type: "boolean" },
          issue: { type: "string" },
        },
      },
    },
    fix: {
      type: "object",
      additionalProperties: false,
      required: ["strategy", "notes"],
      properties: {
        strategy: {
          type: "string",
          enum: ["revise-prompt", "change-inputs", "canvas-blocking"],
        },
        notes: { type: "string" },
        revised_prompt: { type: "string" },
        inputs: {
          type: "object",
          additionalProperties: false,
          properties: {
            add: { type: "array", items: { type: "string" } },
            remove: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

interface JudgeBody {
  shot: {
    title?: string;
    spec: Partial<ShotSpec>;
    version: number;
    promptUsed?: string;
    /** The script lines this shot must stage — checked element by element. */
    scriptExcerpt?: string;
  };
  frameUrl: string;
  locationUrl?: string;
  prevFrameUrl?: string;
  canvasUrl?: string;
  /** The next shot's entry_continuity — where the action must be headed. */
  nextEntry?: string;
  scaleAnchors?: string[];
  artDirection?: string;
  /** Scene-level premise invariants (who chases whom, direction of travel). */
  invariants?: string[];
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
    body.invariants?.length
      ? `SCENE INVARIANTS (the premise — must hold in every frame unless the spec stages a deliberate exception):\n${body.invariants
          .map((s) => `- ${s}`)
          .join("\n")}`
      : "",
    `SPEC:\n${JSON.stringify(spec, null, 2)}`,
    body.shot.scriptExcerpt?.trim()
      ? `SCRIPT EXCERPT (the beat this frame must stage — every concrete requirement in it is checkable):\n${body.shot.scriptExcerpt.trim()}`
      : "",
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

  let verdict: JudgeVerdict | null = null;
  for (let attempt = 0; attempt < 3 && !verdict; attempt++) {
    try {
      // Claude Sonnet 5 judges (independent of the grok planner); grok fallback
      // when no ANTHROPIC_API_KEY is configured. Generous token budget: the
      // model's thinking counts against max_tokens, and a truncated reply is
      // what produces unparseable verdicts.
      const raw = await reviewChat({
        system,
        content,
        maxTokens: 16384,
        temperature: 0.2,
        jsonSchema: VERDICT_SCHEMA,
      });
      verdict = extractJson<JudgeVerdict>(raw);
    } catch {
      // retry; fall through to synthetic verdict after
    }
  }
  if (!verdict) {
    // Marked unparseable so the run loop re-judges instead of burning a
    // generation + fix on a verdict that never existed.
    verdict = {
      version: body.shot.version,
      unparseable: true,
      pass: false,
      checks: [],
      summary: "Judge reply was unparseable — review did not complete.",
      fix: {
        strategy: "revise-prompt",
        notes:
          "Judge output could not be parsed; re-run the review rather than acting on this verdict.",
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
