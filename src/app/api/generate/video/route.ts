import { NextResponse } from "next/server";
import { generateVideo } from "@/lib/generate";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json();
  const { projectId, prompt, modelId, startImageUrl, endImageUrl, videoUrl, duration } =
    body;

  if (!projectId || !startImageUrl) {
    return NextResponse.json(
      { error: "projectId and startImageUrl are required" },
      { status: 400 }
    );
  }

  try {
    const asset = await generateVideo({
      projectId,
      prompt: prompt ?? "",
      modelId: modelId ?? "grok-imagine-1.5-720p",
      startImageUrl,
      endImageUrl,
      videoUrl,
      duration,
    });
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
