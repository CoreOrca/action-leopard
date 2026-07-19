import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Client uploads (required for files > 4.5 MB: videos, NBP 2K/4K images).
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: [
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "video/mp4",
          "video/webm",
          "video/quicktime",
        ],
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ userId: user.id, pathname }),
      }),
      // No onUploadCompleted: asset rows are created by the client after the
      // upload, and the callback needs a public URL (warns on localhost).
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
