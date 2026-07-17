import { XAI_MODEL } from "./models";

const XAI_URL = "https://api.x.ai/v1/chat/completions";

export type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } }
    >;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatContent | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

/** Non-streaming chat completion against the xAI API. */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ChatResult> {
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: XAI_MODEL,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`xAI API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? "stop",
  };
}

/** Extract the first JSON object from a model reply that may include prose or fences. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model reply");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
