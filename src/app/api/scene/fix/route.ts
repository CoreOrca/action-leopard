import { NextResponse } from "next/server";
import { reviewChat } from "@/lib/anthropic";
import {
  ACTION_DIRECTIVES,
  IMAGE_PROMPT_SYSTEM,
  SHOT_FIX_ADDENDUM,
} from "@/lib/prompts";
import type { JudgeVerdict, ShotSpec } from "@/lib/types";

export const maxDuration = 120;

interface FixBody {
  spec: Partial<ShotSpec>;
  verdict: JudgeVerdict;
  currentPrompt: string;
  /** The generator inputs the rewritten prompt must enumerate, in order. */
  imageRoles?: { url: string; role: string }[];
  artDirection?: string;
  scaleAnchors?: string[];
  /** Scene-level premise invariants (who chases whom, direction of travel). */
  invariants?: string[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as FixBody;
  if (!body.currentPrompt || !body.verdict) {
    return NextResponse.json(
      { error: "currentPrompt and verdict are required" },
      { status: 400 }
    );
  }

  const directive = body.spec?.directive
    ? ACTION_DIRECTIVES[body.spec.directive]
    : null;
  const system = `${IMAGE_PROMPT_SYSTEM}${directive ? `\n\n${directive}` : ""}\n${SHOT_FIX_ADDENDUM}`;

  const lines = [
    body.invariants?.length
      ? `SCENE INVARIANTS (the premise — the rewritten prompt must stage these as hard facts unless the spec states an exception):\n${body.invariants
          .map((s) => `- ${s}`)
          .join("\n")}`
      : "",
    `SHOT SPEC:\n${JSON.stringify(body.spec ?? {}, null, 2)}`,
    body.scaleAnchors?.length
      ? `REAL-WORLD SCALE ANCHORS (cite these, with the subject's ratio to them):\n${body.scaleAnchors
          .map((a) => `- ${a}`)
          .join("\n")}`
      : "",
    body.artDirection?.trim() ? `ART DIRECTION (law): ${body.artDirection.trim()}` : "",
    body.imageRoles?.length
      ? `ATTACHED IMAGES THE GENERATOR WILL SEE (in order):\n${body.imageRoles
          .map((r, i) => `${i + 1}. ${r.role}`)
          .join("\n")}`
      : "",
    `FAILED PROMPT:\n${body.currentPrompt}`,
    `JUDGE'S VERDICT:\n${JSON.stringify(body.verdict, null, 2)}`,
  ].filter(Boolean);

  try {
    // Claude Sonnet 5 rewrites (independent of the grok planner); grok
    // fallback when no ANTHROPIC_API_KEY is configured.
    // Generous budget: the model's thinking counts against max_tokens and a
    // truncated rewrite loses its closing invariants.
    const raw = await reviewChat({
      system,
      content: lines.join("\n\n"),
      maxTokens: 16384,
      temperature: 0.6,
    });
    const prompt = raw.trim();
    if (!prompt) throw new Error("Fix pass returned an empty prompt");
    return NextResponse.json({ prompt });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
