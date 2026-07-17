# Action Leopard

Spatial control for generated action. Translate real locations into malleable scenes on a canvas, direct with precision, and generate video that obeys — built for professional filmmakers and serious AI-video creators working inside the constraints of scenes and locations that already exist.

## The core idea

Video models revert objects, vehicles, people, and architecture to "most likely" trajectories because text prompts (even with a start frame) are lossy. Action Leopard adds a layer of **spatial determinism**:

1. **Reference → scene**: grok-4.5 (vision) translates your location image into movable blocking objects on a tldraw canvas.
2. **Canvas → control frames**: canvas screenshots + art direction images go to Nano Banana Pro to stage **frame A**, then a "same camera, N seconds later" edit produces **frame B** — the end frame implicitly encodes a displacement vector for every object.
3. **Frames → video**: Kling 3 Pro interpolates A→B (start/end frame); Grok Imagine 1.5 animates a single frame with a screen-space-directed motion prompt. Chain 5-second beats for long sequences — storyboarding, mechanized.

The prompt writer (grok-4.5) is trained by system prompt to describe **the delta between two stills** and to direct in **screen space** ("enters frame bottom-right", "the ocean stays on the right edge for the entire shot") — language video models actually obey.

## Stack

- Next.js (App Router) on Vercel · Supabase (Postgres + Auth) · Vercel Blob (all media, app-owned URLs)
- LLM: **grok-4.5** via the xAI API directly (prompt writer + production agent + scene translation)
- Image: **Nano Banana Pro** (`fal-ai/gemini-3-pro-image-preview/edit`)
- Video: **Grok Imagine 1.5** i2v 480/720/1080p (`xai/grok-imagine-video/v1.5/image-to-video`), **Kling 3 Pro** start+end frames (`fal-ai/kling-video/v3/pro/image-to-video`), Kling 3 Pro motion control (guide video)
- Canvas: tldraw SDK · State: zustand

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in values (see below)
pnpm dev
```

### Environment

All keys live in `.env.local` (gitignored). Required:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page — the `sb_publishable_...` key |
| `SUPABASE_SECRET_KEY` | Same page — `sb_secret_...` (server only) |
| `XAI_API_KEY` | console.x.ai |
| `FAL_KEY` | fal.ai dashboard → Keys |
| `BLOB_READ_WRITE_TOKEN` | Vercel dashboard → Storage → `action-leopard-blob` → “Connect / .env.local” |

The legacy `SUPABASE_ANON_KEY` / `SERVICE_ROLE_KEY` / `JWT_SECRET` fields are **not needed** — this app uses the new publishable/secret API keys.

### Supabase auth configuration (one-time, in the dashboard)

1. **Authentication → URL Configuration**: set Site URL to `http://localhost:3001` (add your production URL after deploy) and add `http://localhost:3001/**` to Redirect URLs.
2. **Authentication → Email Templates → Confirm signup**: change the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   (required for the server-side confirm flow in `src/app/auth/confirm/route.ts`).

### Database

Migrations live in `supabase/migrations/`. They have already been applied to the linked project; to re-apply elsewhere use the Supabase SQL editor or `supabase db push`.

## Workspace tour

- **Top bar**: hamburger + project name · image/video model selectors (switchable per generation) · theme toggle · account menu.
- **Left panel**: intent, location reference image, art direction (text + images — law for the prompt writer), elements (characters/props/vehicles with images and notes).
- **Canvas**: “✦ Scene from image” builds the movable blocking scene from your reference. Sketch freely, move objects, then “Save shot” to capture a blocking sketch as an input image. “Annotate” (from the preview panel) places any image as a locked background to draw motion paths on.
- **Preview**: asset viewer + image palette. Mark any image as **Start frame (A)** / **End frame (B)** for video generation.
- **Prompt bar**: ✦ Frame A / ✦ Frame B / ✦ Video prompt buttons call grok-4.5; the result is editable and autosaves. Generate image / Generate video use the models selected in the top bar.
- **Sequence strip**: generated clips in order — drag to reorder, click to play in a modal, download.
- **⟡ Agent**: conversational production agent (grok-4.5 with tools) that can translate scenes onto your canvas, write prompts, and generate — while you watch each step.

## Roadmap (pipeline is built to be aware of these)

- **Shot framing / 360° camera**: scene objects retain normalized spatial coords (`SceneObject`), ready to be lifted into an explorable 3-D blocking view for framing shots from any angle, plus drawn camera trajectories.
- **Canvas animation → guide video**: record object motion on the canvas as a video input for Kling motion-control / video-input models.
- Side-by-side canvas / framed-shot preview; Google OAuth; payments.

## Credits caution

fal credits are limited. The app never generates without an explicit click or an explicit agent instruction, and the agent confirms before generating more than two assets in one step.
