import { NextResponse } from "next/server";
import { chat, extractJson } from "@/lib/xai";
import { SCENE_OUTLINE_ADDENDUM, SCENE_TRANSLATE_SYSTEM } from "@/lib/prompts";
import type { SceneTranslation } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { imageUrl, intent, mode } = await request.json();
  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
  }

  const system =
    mode === "outlines"
      ? SCENE_TRANSLATE_SYSTEM + SCENE_OUTLINE_ADDENDUM
      : SCENE_TRANSLATE_SYSTEM;

  try {
    const result = await chat(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: intent
                ? `The filmmaker's intent for this location: ${intent}\n\nTranslate this reference image into a blocking diagram.`
                : "Translate this reference image into a blocking diagram.",
            },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
      { temperature: 0.2, maxTokens: mode === "outlines" ? 16384 : 8192 }
    );

    const scene = extractJson<SceneTranslation>(result.content ?? "");
    return NextResponse.json({ scene });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
