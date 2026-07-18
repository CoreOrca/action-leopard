import Anthropic from "@anthropic-ai/sdk";
import { chat, type ChatContent } from "./xai";

/**
 * Claude Sonnet 5 as the independent reviewer: the judge and prompt rewriter
 * run on a DIFFERENT model family than the planner (grok-4.5), so the loop's
 * verifier does not share the builder's blind spots. Falls back to grok when
 * no ANTHROPIC_API_KEY is configured.
 */
export const REVIEW_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function toAnthropicContent(
  content: ChatContent
): Anthropic.ContentBlockParam[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image",
          source: { type: "url", url: part.image_url.url },
        }
  );
}

/**
 * One vision/text completion for review work (judge + fix). Uses Claude
 * Sonnet 5 when configured; otherwise grok-4.5. Returns the reply text.
 * Note: Sonnet 5 rejects sampling params — `temperature` only applies to the
 * grok fallback. Adaptive thinking is on by default and helps the spatial
 * reasoning these calls exist for.
 */
export async function reviewChat(opts: {
  system: string;
  content: ChatContent;
  maxTokens?: number;
  /** grok fallback only */
  temperature?: number;
  /** When set, Sonnet 5 output is constrained to this JSON schema (guaranteed-valid JSON). */
  jsonSchema?: Record<string, unknown>;
}): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await getClient().messages.create({
      model: REVIEW_MODEL,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.system,
      messages: [{ role: "user", content: toAnthropicContent(opts.content) }],
      ...(opts.jsonSchema
        ? {
            output_config: {
              format: { type: "json_schema" as const, schema: opts.jsonSchema },
            },
          }
        : {}),
    });
    if (res.stop_reason === "refusal") throw new Error("review model refused");
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    if (!text.trim()) throw new Error("review model returned no text");
    return text;
  }
  const result = await chat(
    [
      { role: "system", content: opts.system },
      { role: "user", content: opts.content },
    ],
    { temperature: opts.temperature ?? 0.2, maxTokens: opts.maxTokens ?? 8192 }
  );
  return result.content ?? "";
}
