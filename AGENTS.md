<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Action Leopard — project guide

Next.js App Router app for **spatial control of AI-generated action video**: translate real location photos into malleable scenes on a tldraw canvas, produce control frames (A/B pairs), and generate video that respects placement, motion and proportion. Audience: professional filmmakers. Won the competition it was built for; now a real product.

## Commands

- `pnpm dev -p 3001` — dev server (env expects port **3001**)
- `pnpm build` — production build + typecheck (this is the verification gate; no test suite)
- DB migrations: files in `supabase/migrations/`, applied via a throwaway Node `pg` script against `POSTGRES_URL_NON_POOLING` from `.env.local` (no supabase CLI installed). All 4 migrations are applied to the live DB.

## Stack & keys

- Supabase (Postgres+Auth, new-style `sb_publishable_`/`sb_secret_` keys — legacy anon/service-role NOT used), Vercel Blob (all media; client uploads via `/api/blob/upload`), fal.ai (image/video/segmentation), xAI API direct (`grok-4.5` — exact model id) for all LLM work.
- All keys in `.env.local` (gitignored). **fal credits are LIMITED** — never generate media in testing without asking; cheap LLM smoke tests are fine.
- Supabase email confirmation is disabled (no SMTP); signup logs straight in. `/auth/confirm` handles both `?code=` and `token_hash` flows for when it's re-enabled.

## Model registry (`src/lib/models.ts`)

- Image: `nano-banana-pro` (`fal-ai/gemini-3-pro-image-preview/edit`), `nano-banana-2` (`fal-ai/nano-banana-2/edit`).
- Video: Grok Imagine 1.5 @ 480/720/1080p (`xai/grok-imagine-video/v1.5/image-to-video`); `kling-3-pro` (`fal-ai/kling-video/v3/pro/image-to-video`, start+end frames); `kling-3-pro-motion` (guide video); `seedance-2` (`bytedance/seedance-2.0/image-to-video`, start+end); `seedance-2-fast` (`bytedance/seedance-2.0/fast/reference-to-video`, up to 9 ref images + 3 guide videos, refs addressed as `@Image1`/`@Video1` in the prompt).
- Segmentation: `fal-ai/sam-3-1/image` (text + point + box prompts, per-instance masks). Also available: `fal-ai/sam-3/3d-objects` (image+masks → per-object GLB/gaussian splats + camera pose) — earmarked for the future 360° shot-framing stage.
- fal endpoint prefixes vary (`fal-ai/...`, `bytedance/...`, `xai/...`). Verify any new endpoint via `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` BEFORE writing integration code.

## Architecture map

- `src/lib/prompts.ts` — ALL system prompts: director voice, screen-space directing rules, frame A→B delta strategy with proportion discipline (never "larger in frame"; anchor scale to environment), art-direction-images-are-style-only rules, scene translation (+ outline addendum, structural-elements rules), agent prompt. This file is the product's soul; edit deliberately.
- `src/lib/generate.ts` — server: fal calls per model family → copy output to Blob (`copyToBlob`) → insert `assets` row.
- `src/lib/canvas.ts` — client tldraw helpers: `sceneToCanvas` (blocks/outlines), `cutoutsToCanvas` (movable PNG pieces), scale legend, canvas→PNG export, `saveBlobAsAsset` (upload + asset row), `uploadBlobOnly` (upload only — cutout pieces), annotate-background, clear. tldraw v5 draw shapes need `compressLegacySegments` from `@tldraw/tlschema` (direct dep, pinned to tldraw's version).
- `src/lib/segment.ts` — client mask processing: `traceMask` (binarize → Moore-neighbor contour → RDP simplify), `cutoutFromMask` (mask×reference → cropped transparent PNG). Threshold: alpha>127 && r+g+b>380.
- API routes: `scene/translate` (grok vision → JSON blocking diagram + scale_anchors; mode blocks|outlines), `scene/segment` (per-box SAM 3.1 masks, cap 24, concurrency 4), `prompt/write` (modes image-a/image-b/video; cites scale anchors), `generate/image|video`, `agent` (SSE tool loop: translate_scene, generate_image, generate_video, list_assets), `assets/delete` (Blob del + row), `blob/upload`.
- UI: `Workspace.tsx` orchestrates. `CanvasPanel` (scene-mode select cutouts/traced/outlines/blocks, ✦ Scene from image, Save shot, Clear), `PreviewPanel` (viewer + image palette, A/B frame marking, upload outside image, annotate, delete), `PromptBar` (Frame A/B/Video tabs → `projects.prompts` jsonb, input chips include/exclude), `VideoStrip` (click=preview, dblclick=modal player z-200), `SidePanel` (intent, reference, art direction text+thumbs, elements, agent launcher), `AgentModal` (SSE chat; applies translate_scene results to canvas), `TopBar` (hamburger: projects/assets/+new project; model selects; theme icon), `/studio/assets` page (all assets, filters, viewer, copy URL/download/delete).
- State: zustand (`src/lib/store.ts`). Theme: `.dark` class + localStorage `al-theme`; tldraw follows via MutationObserver; canvas wrapper is `isolate z-0` so modals stay above tldraw's internal z-indexes.
- DB (all RLS `auth.uid() = user_id`): `projects` (intent, art_direction, reference_image_url, canvas_snapshot jsonb, prompts jsonb {image_a,image_b,video}, scene_meta jsonb {summary, scale_anchors}, image_model, video_model), `elements` (kind/name/notes/image_url), `assets` (type: image|video|canvas-shot|drawing|reference|art-direction; sort_order drives the sequence strip), `agent_messages` (unused so far).

## UI style rules (user is strict)

Minimalist black/white, fine 1px borders, sharp corners (global CSS kills border-radius except inside tldraw), Geist sans + Geist Mono accents, NO blue/purple UI, red/green only when semantically necessary, light+dark modes, no clutter.

## Current state / known issues (as of 2026-07-17)

1. **TOP PRIORITY — Cutouts/Traced segmentation quality is poor.** First live test (Chongqing Raffles City aerial): masks patchy with holes, background regions (sky/skyline/river) came out as amorphous blobs, and the key whole objects (people, main left tower, sky bridges, orange walkway) were not cleanly isolated. Traced mode was worse than grok Outlines. Diagnosis + plan:
   - Current flow: grok blocks translation → per-object **box** prompts to SAM 3.1 (`apply_mask:false`) → threshold white-ish pixels client-side. The actual SAM 3.1 mask output format was never verified live — masks may be soft/gray or overlay-style, which would break the threshold (explains holes/patchiness).
   - Next session plan: (a) run ONE cheap live SAM 3.1 call and inspect the returned mask PNG before anything else; (b) switch to **text-concept prompts** (`prompt: "person"`, `"skyscraper"`, `"elevated walkway"`, `"sky bridge"`) with `return_multiple_masks: true, include_boxes: true`, then match returned instances to grok objects by IoU against grok's boxes — SAM 3 text prompts segment whole semantic objects, exactly what box prompts are failing at; (c) mask cleanup: flood-fill hole filling, morphological close, drop components <1% of bbox area; (d) in cutouts mode skip amorphous background kinds (sky, skyline, river, ground) — render those as blocks/outlines behind the cutout pieces; (e) try `apply_mask: true`, which may return ready-made cutouts directly.
2. Scene-mode default is `cutouts`; v1 baseline (blocks) preserved — revert point commit `6f1a2e5`.
3. Canvas-animation → guide-video recording unimplemented (tldraw renders DOM, not `<canvas>`; needs WebCodecs approach). Users can upload their own guide videos meanwhile.
4. 360° shot-framing stage not started; `sam-3/3d-objects` fed by the cutout masks is the likely on-ramp; `SceneObject` keeps normalized coords for this.
5. Seedance-2-fast multi-image refs (`@Image2`+) not yet wired to element images — natural extension of the input-chips row.
6. Agent messages not persisted to `agent_messages` yet.

## Working preferences

- User tests in the browser and reports back with annotated screenshots; iterate on that feedback.
- Commit and push to `origin main` (https://github.com/CoreOrca/action-leopard) after each working increment; end commit messages with the Claude co-author line.
- The prompt-writing quality (screen-space directing, proportion discipline, no embellishment, no imposed golden hour, art direction as law) is the core differentiator — protect it.
