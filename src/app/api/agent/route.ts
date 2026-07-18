import { chat, extractJson, type ChatMessage, type ToolDef } from "@/lib/xai";
import { AGENT_SYSTEM, SCENE_TRANSLATE_SYSTEM } from "@/lib/prompts";
import { generateImage, generateVideo } from "@/lib/generate";
import { createClient } from "@/lib/supabase/server";
import type { SceneTranslation } from "@/lib/types";

export const maxDuration = 300;

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "translate_scene",
      description:
        "Look at a reference image of a location and translate it into a movable blocking diagram that appears on the user's canvas. Use when the user wants their location image turned into a scene.",
      parameters: {
        type: "object",
        properties: {
          image_url: { type: "string", description: "URL of the reference image" },
        },
        required: ["image_url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image with Nano Banana Pro from a prompt plus input images (reference photo, canvas sketch, element images, or a frame A to edit into a frame B).",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The full image prompt" },
          image_urls: {
            type: "array",
            items: { type: "string" },
            description: "Input image URLs, most important first",
          },
          aspect_ratio: {
            type: "string",
            description: "Optional, e.g. 16:9, 21:9",
          },
        },
        required: ["prompt", "image_urls"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video",
      description:
        "Generate a video clip. Use the user's selected video model unless directed otherwise. Kling supports an end frame; motion-control needs a guide video.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The full video prompt" },
          model_id: {
            type: "string",
            enum: [
              "grok-imagine-1.5-480p",
              "grok-imagine-1.5-720p",
              "grok-imagine-1.5-1080p",
              "kling-3-pro",
              "kling-3-pro-motion",
              "seedance-2",
              "seedance-2-fast",
            ],
          },
          start_image_url: { type: "string" },
          end_image_url: { type: "string" },
          video_url: { type: "string", description: "Guide video URL" },
          duration: { type: "number", description: "Seconds" },
        },
        required: ["prompt", "model_id", "start_image_url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_assets",
      description: "List this project's saved assets (images and videos) with URLs.",
      parameters: { type: "object", properties: {} },
    },
  },
];

interface AgentBody {
  projectId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  context: {
    intent: string;
    artDirection: string;
    referenceImageUrl: string | null;
    imageModel: string;
    videoModel: string;
    elements: { kind: string; name: string; notes: string; image_url: string | null }[];
    canvasShotUrl?: string | null;
    sceneMeta?: { summary?: string; scale_anchors?: string[] };
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as AgentBody;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        const ctx = body.context;
        const contextBlock = [
          `PROJECT CONTEXT`,
          `Intent: ${ctx.intent || "(none yet)"}`,
          `Art direction: ${ctx.artDirection || "(none)"}`,
          `Reference image: ${ctx.referenceImageUrl ?? "(none uploaded)"}`,
          `Latest canvas shot: ${ctx.canvasShotUrl ?? "(none)"}`,
          `Selected image model: ${ctx.imageModel} · Selected video model: ${ctx.videoModel}`,
          ...(ctx.sceneMeta?.scale_anchors?.length
            ? [
                `Real-world scale anchors (keep all proportions true to these): ${ctx.sceneMeta.scale_anchors.join("; ")}`,
              ]
            : []),
          `Elements:`,
          ...(ctx.elements.length
            ? ctx.elements.map(
                (e) =>
                  `- [${e.kind}] ${e.name}${e.notes ? ` — ${e.notes}` : ""}${
                    e.image_url ? ` (image: ${e.image_url})` : ""
                  }`
              )
            : ["(none)"]),
        ].join("\n");

        const messages: ChatMessage[] = [
          { role: "system", content: `${AGENT_SYSTEM}\n\n${contextBlock}` },
          ...body.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })) as ChatMessage[],
        ];

        for (let step = 0; step < 8; step++) {
          const result = await chat(messages, {
            tools: TOOLS,
            temperature: 0.5,
            maxTokens: 4096,
          });

          if (result.content) send({ type: "text", text: result.content });

          if (!result.toolCalls.length) break;

          messages.push({
            role: "assistant",
            content: result.content,
            tool_calls: result.toolCalls,
          });

          for (const call of result.toolCalls) {
            const args = JSON.parse(call.function.arguments || "{}");
            send({ type: "tool_start", name: call.function.name, args });

            let toolResult: unknown;
            try {
              toolResult = await runTool(call.function.name, args, body, user.id);
              send({ type: "tool_result", name: call.function.name, result: toolResult });
            } catch (err) {
              toolResult = { error: (err as Error).message };
              send({ type: "tool_error", name: call.function.name, error: (err as Error).message });
            }

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(toolResult).slice(0, 20000),
            });
          }
        }

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  body: AgentBody,
  userId: string
): Promise<unknown> {
  switch (name) {
    case "translate_scene": {
      const result = await chat(
        [
          { role: "system", content: SCENE_TRANSLATE_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Translate this reference image into a blocking diagram." },
              {
                type: "image_url",
                image_url: { url: String(args.image_url), detail: "high" },
              },
            ],
          },
        ],
        { temperature: 0.2, maxTokens: 8192 }
      );
      const scene = extractJson<SceneTranslation>(result.content ?? "");
      // The client watches for this tool result and builds the canvas shapes.
      return { scene, applied_to_canvas: true };
    }
    case "generate_image": {
      const assets = await generateImage({
        projectId: body.projectId,
        prompt: String(args.prompt),
        imageUrls: (args.image_urls as string[]) ?? [],
        modelId: body.context.imageModel,
        aspectRatio: args.aspect_ratio as string | undefined,
      });
      return {
        assets: assets.map((a) => ({ id: a.id, url: a.url, type: a.type })),
      };
    }
    case "generate_video": {
      const asset = await generateVideo({
        projectId: body.projectId,
        prompt: String(args.prompt),
        modelId: String(args.model_id ?? body.context.videoModel),
        startImageUrl: String(args.start_image_url),
        endImageUrl: args.end_image_url as string | undefined,
        videoUrl: args.video_url as string | undefined,
        duration: args.duration as number | undefined,
      });
      return { asset: { id: asset.id, url: asset.url, type: asset.type } };
    }
    case "list_assets": {
      const supabase = await createClient();
      const { data } = await supabase
        .from("assets")
        .select("id, type, url, model, prompt, created_at")
        .eq("project_id", body.projectId)
        .eq("user_id", userId)
        .order("sort_order");
      return { assets: data ?? [] };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
