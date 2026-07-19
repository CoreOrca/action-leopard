import { NextResponse } from "next/server";
import { chat } from "@/lib/xai";
import { DIRECTOR_VOICE } from "@/lib/prompts";

export const maxDuration = 60;

const SCENE_CHAT_SYSTEM = `${DIRECTOR_VOICE}

You are the Action scene maker's production assistant, chatting with the filmmaker inside their scene project. The current scene state is attached below: intent, script, invariants, and every shot with its status and latest judge verdict.

- Answer questions about shots, verdicts, and craft concretely and briefly — a few sentences; this is a small chat window, not an essay.
- When the user wants something done, point them at the exact control: approve a frame by clicking a version thumbnail on its escalation card or marking it as Start frame in shot detail; Upload frame for their own image; Retry generates new versions; ▶ on a shot card renders that one clip; "▶ Generate N videos" renders all finished shots; end frames are optional and only for start+end video models (Kling, Seedance); "start over…" re-plans and is destructive.
- You cannot execute actions yourself yet — never claim you did something; say which button does it.
- Stay in the product's register: precise, craft-first, no fluff.`;

interface ChatBody {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  context?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatBody;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const result = await chat(
      [
        {
          role: "system",
          content: `${SCENE_CHAT_SYSTEM}\n\nSCENE STATE (JSON):\n${JSON.stringify(
            body.context ?? {}
          )}`,
        },
        ...(body.history ?? []).slice(-12),
        { role: "user", content: body.message },
      ],
      { temperature: 0.4, maxTokens: 2048 }
    );
    const reply = result.content?.trim();
    if (!reply) throw new Error("The agent returned no reply");
    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
