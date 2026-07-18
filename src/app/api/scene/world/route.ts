import { NextResponse } from "next/server";
import { generateImage } from "@/lib/generate";
import type { Asset } from "@/lib/types";

export const maxDuration = 300;

interface AtlasObject {
  id: string;
  label: string;
  kind: string;
  mobile: boolean;
  r: number;
  g: number;
  b: number;
}

function hex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function platePrompt(subjectHints: string[]): string {
  const list =
    subjectHints.length > 0
      ? subjectHints.slice(0, 12).join(", ")
      : "vehicles, people, and temporary action elements";
  return [
    "Edit this photograph to produce a clean empty location plate.",
    `Remove these subjects completely: ${list}.`,
    "Reconstruct continuous road, ground, barriers, water, architecture, and terrain as if those subjects were never there.",
    "Keep the exact same camera angle, lens, framing, lighting, weather, and color grade.",
    "Photorealistic. No new objects, no people, no vehicles, no text, no logos, no watermark, no style change.",
  ].join(" ");
}

function atlasPrompt(objects: AtlasObject[]): string {
  const lines = objects.map(
    (o) =>
      `- "${o.label}" (${o.kind}): fill its ENTIRE visible silhouette with solid ${hex(o.r, o.g, o.b)} only — leave nothing of this object unpainted`
  );
  return [
    "Recolor this photograph into a hard-edged flat color INSTANCE MAP for segmentation.",
    "Each listed element gets ONE solid unique color — no gradients, no textures, no shadows, no labels, no text, no outlines, no anti-aliased blend between regions.",
    "Keep the exact same framing, proportions, and camera as the input image.",
    "",
    "CRITICAL COMPLETENESS:",
    "- You MUST paint EVERY object in the legend. Do not skip large architecture.",
    "- Horizontal and curved GLASS skybridges, skywalks, and cylindrical glass links are often the largest hero structures — if listed, fill their full glass mass, not just a connector stub.",
    "- Towers, walkways, railings, cars, and people are separate regions even when they touch.",
    "",
    "CRITICAL SEPARATION (no merging):",
    "- NEVER paint a person the same color as architecture, walkway, glass, or railing under their feet.",
    "- NEVER paint tire spray, dust, sand, smoke, or road surface as part of a vehicle — only the vehicle body.",
    "- People = tight body silhouette only. Vehicles = body + wheels only.",
    "",
    "Color legend (use these exact RGB hex colors):",
    ...lines,
    "",
    "Anything not listed (empty sky, continuous river/ocean if unlisted, far haze): solid #F0F0F0.",
    "Output pure posterized flat regions only — graphic color key, not a painting.",
  ].join("\n");
}

/**
 * Scene world prep for cinematic cutouts:
 * - plate: remove mobile subjects → empty location backdrop
 * - atlas: flat color instance map for precise sticker extraction
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    mode: "plate" | "atlas";
    imageUrl: string;
    projectId: string;
    modelId?: string;
    /** Labels of subjects to remove (plate mode) */
    subjectLabels?: string[];
    /** Legend with assigned RGB (atlas mode) */
    objects?: AtlasObject[];
  };

  const { mode, imageUrl, projectId, modelId, subjectLabels, objects } = body;

  if (!imageUrl || !projectId || !mode) {
    return NextResponse.json(
      { error: "mode, imageUrl, and projectId are required" },
      { status: 400 }
    );
  }

  if (mode === "atlas" && !objects?.length) {
    return NextResponse.json(
      { error: "objects legend required for atlas mode" },
      { status: 400 }
    );
  }

  try {
    const prompt =
      mode === "plate"
        ? platePrompt(subjectLabels ?? [])
        : atlasPrompt(objects!);

    const assets: Asset[] = await generateImage({
      projectId,
      prompt,
      imageUrls: [imageUrl],
      modelId: modelId ?? "nano-banana-pro",
      resolution: "1K",
    });

    // Tag metadata so the assets page can filter world helpers
    // (generateImage already stored fal metadata; client can treat by prompt)

    return NextResponse.json({
      url: assets[0]?.url ?? null,
      assets,
      mode,
      prompt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
