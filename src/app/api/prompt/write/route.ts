import { NextResponse } from "next/server";
import { chat, type ChatMessage } from "@/lib/xai";
import { IMAGE_PROMPT_SYSTEM, VIDEO_PROMPT_SYSTEM } from "@/lib/prompts";

export const maxDuration = 120;

interface WritePromptBody {
  /** "image-a" = staging frame, "image-b" = same-scene-later edit, "video" = video prompt */
  mode: "image-a" | "image-b" | "video";
  intent: string;
  artDirection?: string;
  elements?: { kind: string; name: string; notes: string }[];
  /** URLs of images the model should look at (reference, canvas sketch, frame A...) */
  imageUrls?: { url: string; role: string }[];
  /** For image-b: the prompt that produced frame A */
  frameAPrompt?: string;
  /** For video: which model the prompt targets */
  videoModel?: string;
  /** Seconds between frame A and frame B, or clip duration */
  seconds?: number;
  extra?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as WritePromptBody;
  if (!body.intent && !body.extra) {
    return NextResponse.json({ error: "intent required" }, { status: 400 });
  }

  const system = body.mode === "video" ? VIDEO_PROMPT_SYSTEM : IMAGE_PROMPT_SYSTEM;

  const parts: string[] = [];
  parts.push(`FILMMAKER'S INTENT:\n${body.intent}`);
  if (body.artDirection?.trim())
    parts.push(`ART DIRECTION (law — follow it):\n${body.artDirection}`);
  if (body.elements?.length)
    parts.push(
      `ELEMENTS IN THIS PROJECT:\n${body.elements
        .map((e) => `- [${e.kind}] ${e.name}${e.notes ? ` — ${e.notes}` : ""}`)
        .join("\n")}`
    );
  if (body.mode === "image-a")
    parts.push(
      "Write the Nano Banana Pro prompt for FRAME A: the staging frame that sets up this beat of action. The attached images are the inputs the model will receive."
    );
  if (body.mode === "image-b")
    parts.push(
      `Write the Nano Banana Pro prompt for FRAME B: an edit of frame A showing the same camera position and scene ${
        body.seconds ?? 5
      } seconds later. Frame A was produced with this prompt:\n${
        body.frameAPrompt ?? "(unknown)"
      }\nDescribe per-object deltas. Keep the edit geometrically plausible.`
    );
  if (body.mode === "video")
    parts.push(
      `Write the video prompt for model: ${body.videoModel ?? "grok-imagine-1.5"}. Clip duration: ${
        body.seconds ?? 6
      } seconds. The attached images are the start${
        body.imageUrls?.some((i) => i.role === "end-frame") ? " and end" : ""
      } frames.`
    );
  if (body.extra?.trim()) parts.push(`ADDITIONAL DIRECTION:\n${body.extra}`);

  const content: ChatMessage["content"] = [
    { type: "text" as const, text: parts.join("\n\n") },
    ...(body.imageUrls ?? []).map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.url, detail: "high" as const },
    })),
  ];

  if (body.imageUrls?.length) {
    (content[0] as { type: "text"; text: string }).text +=
      `\n\nATTACHED IMAGES (in order): ${body.imageUrls.map((i) => i.role).join(", ")}`;
  }

  try {
    const result = await chat(
      [
        { role: "system", content: system },
        { role: "user", content },
      ],
      { temperature: 0.6, maxTokens: 4096 }
    );
    return NextResponse.json({ prompt: (result.content ?? "").trim() });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
