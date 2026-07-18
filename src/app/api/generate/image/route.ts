import { NextResponse } from "next/server";
import { generateImage } from "@/lib/generate";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json();
  const { projectId, prompt, imageUrls, modelId, aspectRatio, resolution, metadata } = body;

  if (!projectId || !prompt || !imageUrls?.length) {
    return NextResponse.json(
      { error: "projectId, prompt and imageUrls are required" },
      { status: 400 }
    );
  }

  try {
    const assets = await generateImage({
      projectId,
      prompt,
      imageUrls,
      modelId: modelId ?? "nano-banana-pro",
      aspectRatio,
      resolution,
      metadata,
    });
    return NextResponse.json({ assets });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
