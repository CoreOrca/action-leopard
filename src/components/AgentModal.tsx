"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/store";
import { sceneToCanvas } from "@/lib/canvas";
import type { Asset, SceneTranslation } from "@/lib/types";

interface ChatItem {
  role: "user" | "assistant" | "event";
  text: string;
  assets?: { url: string; type: string }[];
}

export default function AgentModal({
  projectId,
  editor,
}: {
  projectId: string;
  editor: Editor | null;
}) {
  const { project, elements, assets, setAssets, agentOpen, setAgentOpen } =
    useWorkspace();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items]);

  async function refreshAssets() {
    const { data } = await createClient()
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (data) setAssets(data as Asset[]);
  }

  async function send() {
    if (!input.trim() || running || !project) return;
    const userText = input.trim();
    setInput("");
    const history = [
      ...items.filter((i) => i.role !== "event"),
      { role: "user" as const, text: userText },
    ];
    setItems((prev) => [...prev, { role: "user", text: userText }]);
    setRunning(true);

    try {
      const latestCanvasShot = [...assets]
        .reverse()
        .find((a) => a.type === "canvas-shot");
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          messages: history.map((i) => ({
            role: i.role,
            content: i.text,
          })),
          context: {
            intent: project.intent,
            artDirection: project.art_direction,
            referenceImageUrl: project.reference_image_url,
            imageModel: project.image_model,
            videoModel: project.video_model,
            canvasShotUrl: latestCanvasShot?.url ?? null,
            sceneMeta: project.scene_meta,
            elements: elements.map((e) => ({
              kind: e.kind,
              name: e.name,
              notes: e.notes,
              image_url: e.image_url,
            })),
          },
        }),
      });

      if (!res.ok || !res.body) throw new Error(`Agent error ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawGeneration = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === "text" && event.text) {
            setItems((prev) => [
              ...prev,
              { role: "assistant", text: event.text },
            ]);
          } else if (event.type === "tool_start") {
            setItems((prev) => [
              ...prev,
              { role: "event", text: `⟡ ${event.name} …` },
            ]);
          } else if (event.type === "tool_result") {
            if (event.name === "translate_scene" && editor) {
              const scene = event.result?.scene as SceneTranslation | undefined;
              if (scene) await sceneToCanvas(editor, scene);
              setItems((prev) => [
                ...prev,
                {
                  role: "event",
                  text: `⟡ scene built on canvas — ${scene?.objects.length ?? 0} objects`,
                },
              ]);
            } else if (
              event.name === "generate_image" ||
              event.name === "generate_video"
            ) {
              sawGeneration = true;
              const list =
                event.result?.assets ??
                (event.result?.asset ? [event.result.asset] : []);
              setItems((prev) => [
                ...prev,
                {
                  role: "event",
                  text: `⟡ ${event.name} done`,
                  assets: list,
                },
              ]);
            } else {
              setItems((prev) => [
                ...prev,
                { role: "event", text: `⟡ ${event.name} done` },
              ]);
            }
          } else if (event.type === "tool_error") {
            setItems((prev) => [
              ...prev,
              { role: "event", text: `⟡ ${event.name} failed: ${event.error}` },
            ]);
          } else if (event.type === "error") {
            setItems((prev) => [
              ...prev,
              { role: "event", text: `agent error: ${event.error}` },
            ]);
          }
        }
      }
      if (sawGeneration) await refreshAssets();
    } catch (e) {
      setItems((prev) => [
        ...prev,
        { role: "event", text: `error: ${(e as Error).message}` },
      ]);
    } finally {
      setRunning(false);
    }
  }

  if (!agentOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[70vh] w-104 flex-col border border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest">
          ⟡ Production agent
        </span>
        <button
          onClick={() => setAgentOpen(false)}
          className="font-mono text-xs text-muted hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {items.length === 0 && (
          <p className="font-mono text-[11px] leading-relaxed text-muted">
            Ask for anything: “turn my reference into a scene”, “stage frame A
            and B for the chase”, “generate the first clip with Kling”.
          </p>
        )}
        {items.map((item, i) =>
          item.role === "event" ? (
            <div key={i} className="font-mono text-[10px] text-muted">
              {item.text}
              {item.assets && (
                <div className="mt-1 flex gap-1">
                  {item.assets.map((a, j) =>
                    a.type === "video" ? (
                      /* eslint-disable-next-line jsx-a11y/media-has-caption */
                      <video
                        key={j}
                        src={a.url}
                        controls
                        className="h-24 border border-border-soft"
                      />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={j}
                        src={a.url}
                        alt=""
                        className="h-24 border border-border-soft object-cover"
                      />
                    )
                  )}
                </div>
              )}
            </div>
          ) : (
            <div
              key={i}
              className={`text-xs leading-relaxed ${
                item.role === "user"
                  ? "border-l-2 border-foreground pl-2"
                  : "text-foreground"
              }`}
            >
              {item.text}
            </div>
          )
        )}
        {running && (
          <div className="font-mono text-[10px] text-muted animate-pulse">
            working…
          </div>
        )}
      </div>

      <div className="flex border-t border-border-soft">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Direct the agent…"
          rows={2}
          className="flex-1 resize-none bg-transparent p-2 text-xs outline-none"
        />
        <button
          onClick={send}
          disabled={running}
          className="border-l border-border-soft px-4 font-mono text-[10px] uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
