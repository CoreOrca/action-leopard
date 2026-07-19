"use client";

import JSZip from "jszip";
import type { Asset, Element, Project, Shot, ShotSpec } from "./types";

/**
 * Project export: one zip with every asset organized into folders (inputs,
 * per-shot frames/clips, other generated media) plus prompts.md capturing the
 * script, invariants, specs, and every prompt.
 */

function slug(s: string): string {
  return (
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function extFrom(url: string, fallback: string): string {
  const last = url.split("/").pop()?.split("?")[0] ?? "";
  const dot = last.lastIndexOf(".");
  return dot > -1 ? last.slice(dot + 1).toLowerCase() : fallback;
}

function section(title: string, body?: string | null): string {
  return body?.trim() ? `## ${title}\n\n${body.trim()}\n\n` : "";
}

function fence(label: string, body?: string | null): string {
  return body?.trim() ? `**${label}**\n\n\`\`\`\n${body.trim()}\n\`\`\`\n\n` : "";
}

function buildMarkdown(
  project: Project,
  shots: Shot[],
  elements: Element[]
): string {
  let md = `# ${project.name || "Untitled project"}\n\nExported ${new Date().toISOString().slice(0, 10)} from Action Leopard.\n\n`;
  md += section("Intent", project.intent);
  md += section("Script", project.script);
  md += section("Art direction", project.art_direction);
  md += section("Scene summary", project.scene_meta?.summary);
  if (project.scene_meta?.invariants?.length)
    md += section(
      "Scene invariants",
      project.scene_meta.invariants.map((s) => `- ${s}`).join("\n")
    );
  if (project.scene_meta?.scale_anchors?.length)
    md += section(
      "Scale anchors",
      project.scene_meta.scale_anchors.map((s) => `- ${s}`).join("\n")
    );
  if (project.location_map?.length)
    md += section(
      "Location map (ordered path)",
      project.location_map
        .map(
          (l, i) =>
            `${i + 1}. ${l.label || "Location"}${l.notes ? ` — ${l.notes}` : ""}`
        )
        .join("\n")
    );
  if (elements.length)
    md += section(
      "Elements",
      elements
        .map((e) => `- [${e.kind}] ${e.name}${e.notes ? ` — ${e.notes}` : ""}`)
        .join("\n")
    );

  // Project-level prompts (single-shot workflow).
  md += fence("Project frame A prompt", project.prompts?.image_a);
  md += fence("Project frame B prompt", project.prompts?.image_b);
  md += fence("Project video prompt", project.prompts?.video);

  if (shots.length) {
    md += `## Shots\n\n`;
    shots.forEach((shot, i) => {
      const spec = shot.spec as Partial<ShotSpec>;
      md += `### Shot ${i + 1}${shot.title ? ` — ${shot.title}` : ""}${
        shot.kind === "transition" ? " (transition)" : ""
      }\n\n`;
      md += `Status: ${shot.status}${
        shot.revision_count ? ` (v${shot.revision_count + 1})` : ""
      }\n\n`;
      if (shot.script_excerpt?.trim())
        md += `> ${shot.script_excerpt.trim().replace(/\n/g, "\n> ")}\n\n`;
      const facts = [
        spec.description ? `- Beat: ${spec.description}` : "",
        spec.blocking ? `- Blocking: ${spec.blocking}` : "",
        spec.camera ? `- Camera: ${spec.camera}` : "",
        spec.location_note ? `- Location note: ${spec.location_note}` : "",
        spec.screen_direction ? `- Screen direction: ${spec.screen_direction}` : "",
        spec.entry_continuity ? `- Entry: ${spec.entry_continuity}` : "",
        spec.exit_continuity ? `- Exit: ${spec.exit_continuity}` : "",
        spec.scale_anchors?.length
          ? `- Scale anchors: ${spec.scale_anchors.join("; ")}`
          : "",
      ].filter(Boolean);
      if (facts.length) md += `${facts.join("\n")}\n\n`;
      md += fence("Frame A prompt", shot.prompts?.image_a);
      md += fence("Frame B prompt", shot.prompts?.image_b);
      md += fence("Video prompt", shot.prompts?.video);
    });
  }
  return md;
}

export async function exportProject(opts: {
  project: Project;
  shots: Shot[];
  elements: Element[];
  assets: Asset[];
  onProgress?: (message: string) => void;
}): Promise<void> {
  const { project, shots, elements, assets, onProgress } = opts;
  const zip = new JSZip();
  const rootName = slug(project.name);
  const root = zip.folder(rootName)!;

  root.file("prompts.md", buildMarkdown(project, shots, elements));

  // Collect every remote file with a unique path inside the zip.
  const files: { path: string; url: string }[] = [];
  const used = new Set<string>(["prompts.md"]);
  const claim = (path: string): string => {
    let candidate = path;
    for (let n = 2; used.has(candidate); n++) {
      const dot = path.lastIndexOf(".");
      candidate = dot > -1 ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
    }
    used.add(candidate);
    return candidate;
  };
  const add = (path: string, url: string) => files.push({ path: claim(path), url });

  project.location_map?.forEach((l, i) =>
    add(
      `inputs/locations/${String(i + 1).padStart(2, "0")}-${slug(l.label)}.${extFrom(l.url, "jpg")}`,
      l.url
    )
  );
  elements.forEach((e) => {
    if (e.image_url)
      add(
        `inputs/elements/${slug(`${e.kind}-${e.name}`)}.${extFrom(e.image_url, "png")}`,
        e.image_url
      );
  });

  const shotIndex = new Map(shots.map((s, i) => [s.id, i + 1]));
  for (const a of assets) {
    const e = extFrom(a.url, a.type === "video" ? "mp4" : "png");
    if (a.type === "reference") add(`inputs/reference/${a.id.slice(0, 8)}.${e}`, a.url);
    else if (a.type === "art-direction")
      add(`inputs/art-direction/${a.id.slice(0, 8)}.${e}`, a.url);
    else if (a.metadata?.shot_id && shotIndex.has(a.metadata.shot_id as string)) {
      const n = String(shotIndex.get(a.metadata.shot_id as string)).padStart(2, "0");
      const role = (a.metadata.shot_role as string) || "asset";
      const v = a.metadata.version ? `-v${a.metadata.version}` : "";
      add(`shots/shot-${n}/${role}${v}.${e}`, a.url);
    } else if (a.type === "video") add(`generated/videos/${a.id.slice(0, 8)}.${e}`, a.url);
    else add(`generated/images/${a.id.slice(0, 8)}.${e}`, a.url);
  }

  // Fetch in small batches; skip (but report) anything that fails.
  const failed: string[] = [];
  const BATCH = 4;
  for (let i = 0; i < files.length; i += BATCH) {
    onProgress?.(`Packing export… ${Math.min(i + BATCH, files.length)}/${files.length} files`);
    await Promise.all(
      files.slice(i, i + BATCH).map(async (f) => {
        try {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(String(res.status));
          root.file(f.path, await res.blob());
        } catch {
          failed.push(f.path);
        }
      })
    );
  }
  if (failed.length)
    root.file(
      "export-warnings.txt",
      `These files could not be fetched and are missing from the export:\n${failed.join("\n")}`
    );

  onProgress?.("Compressing export…");
  const blob = await zip.generateAsync({ type: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${rootName}-export.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
