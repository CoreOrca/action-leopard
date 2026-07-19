# Action Leopard

Spatial control for generated action. Translate real locations into malleable scenes on a canvas, direct with precision, and generate video that obeys — built for professional filmmakers and serious AI-video creators working inside the constraints of scenes and locations that already exist.

## The core idea

Video models revert objects, vehicles, people, and architecture to "most likely" trajectories because text prompts (even with a start frame) are lossy. Action Leopard adds a layer of **spatial determinism**:

1. **Reference → scene**: a vision LLM translates your location image into movable blocking objects on a tldraw canvas — or SAM 3.1 segmentation cuts the real photo into feathered stickers over an image-model-generated empty plate, so you rearrange the *actual* location rather than an abstraction.
2. **Canvas → control frames**: canvas screenshots + art direction images go to an image edit model to stage **frame A**, then a "same camera, N seconds later" edit produces **frame B** — the end frame implicitly encodes a displacement vector for every object.
3. **Frames → video**: start+end-frame models interpolate A→B; single-frame models animate frame A with a screen-space-directed motion prompt. Chain 5-second beats for long sequences — storyboarding, mechanized.

The prompt writer is trained by system prompt to describe **the delta between two stills** and to direct in **screen space** ("enters frame bottom-right", "the ocean stays on the right edge for the entire shot") — language video models actually obey. Location photos are treated as **the set**, not a mood board: geometry, landmarks, and proportions are law. Art direction images are **style only** — they may never smuggle content into the frame. Element references (characters, vehicles, props) inform *appearance*, never force *presence*.

## Two ways to work

**Shot projects** — the hands-on path. One location, one shot at a time: build the scene on the canvas, stage frame A and frame B, generate video. You direct every step.

**Scene projects** — the agentic path. Hand over a **script** and an ordered **location map** (labeled photos of the real place, in the order the action moves through it), and a planner/builder/judge loop storyboards, generates, critiques, and repairs an entire multi-shot sequence — pausing only where a human eye is genuinely needed.

## Scene projects: script → storyboard → self-correcting generation

### The planner

One vision-LLM call reads the script against the labeled location images and emits an ordered list of **one-beat shots**, each with a structured `ShotSpec`: subjects, action, camera, and entry/exit continuity. Continuity is **world-state only** — the exit state of shot *k* is the entry state of shot *k+1* (who's ahead, what landmark was just passed, which direction the pack travels) — while the camera stays free to vary shot-to-shot for rhythm. The plan also distills **scene invariants**: 2–5 premise facts ("the coupe is pursued and stays ahead of the sedan", "the pack travels left-to-right") that every downstream check is held against. Deliberate exceptions — an overshoot, a mid-pass — must be stated explicitly in the spec, or they'll be treated as errors.

Each shot lists only the elements *literally visible in that frame*, and only those references are attached to the generation — because an attached character reference tends to force the character into the frame, and the occupants of a moving vehicle usually shouldn't be.

### The loop: Builder → Judge → Manager

After you approve the plan (an explicit gate — nothing generates without it), the run proceeds strictly in shot order:

- **Builder** writes the full frame-A prompt from the spec and generates the start frame, using the location photo, the previous shot's *approved* frame, and the shot's element references as inputs.
- **Judge** — a **separate model from the builder** (Claude, via structured outputs), so the system never grades its own homework — reviews each frame against ground truth: the location reference, the previous approved frame, the spec plus the script excerpt it came from, scale anchors, and the scene invariants. Seven checks: location fidelity, scale/proportion, screen direction, continuity with the adjacent shot, anatomy, script intent (element by element — each vehicle's lane, posture, maneuver phase, effect), and art direction. Crucially, the judge **observes first, then rules**: it must write down what it actually sees (each vehicle's visible face, the implied travel direction) and may only fail a frame by citing those observations.
- **Manager** routes the verdict. A failed frame goes to the **fix rewriter**, which starts from the judge's observations and rewrites the full prompt with explicit counter-instructions ("in the oncoming lane but traveling the SAME direction, taillights to camera"). Regenerate, re-judge, repeat — up to a hard cap of automatic fixes, so a stubborn frame can't silently burn credits.

Every state transition persists to the database, so a refresh (or a cancelled run) resumes exactly where it left off. Continuity input is always the predecessor's judge-*approved* frame — errors don't propagate downstream.

### Escalation is a light touch

When the fix cap is reached, the shot escalates to you — and the escalation card is built to make recovery one click, not a chore: every generated version appears as a clickable thumbnail (the judge may have discarded a frame you'd approve), plus upload-your-own-frame and retry. Re-planning — the one action that destroys hard-won work — is deliberately buried behind a small link and a strengthened confirmation.

Once start frames pass, optional follow-ups fill in **end frames** (for start+end video models) and **video clips** per shot or for the whole sequence — each behind its own confirmation, because fal credits are real money.

### Spatial discipline (what makes the prompts obey)

The system prompts encode a **camera geometry contract**: every image prompt must derive camera position → per-subject visible faces (taillights vs. headlights vs. profile) → per-landmark frame edges, and state the chain twice, because image models bias hard toward front views. Reversing the camera mirrors the entire chain. The **heading-not-lane rule** catches a classic failure: a vehicle's visible face comes from its travel direction, never its lane — otherwise image models draw grilles on anything in the left lane. The planner enforces orientation discipline (the pursued never faces the pursuer), landmark non-repetition with bookkeeping (once the action passes a landmark, prompts carry an explicit "does NOT appear" negative), and plausible engagement distances. Proportion language is anchored to the environment ("reaches the height of the first-floor windows"), never to the frame ("larger in frame").

## Workspace tour

- **Top bar**: hamburger (project switcher, assets, new project) · image/video model selectors (switchable per generation) · theme toggle · account menu.
- **Left panel**: intent, location reference, art direction (text + images — law for the prompt writer), elements (characters/props/vehicles with images and notes), and — in scene projects — the script and the ordered location map.
- **Canvas**: "✦ Scene from image" builds the malleable scene from your reference — cutout stickers (Cinematic or Fast quality), traced outlines, or abstract blocks. Sketch freely, move objects, then "Save shot" to capture the blocking as an input image. "Annotate" places any image as a locked background to draw motion paths on.
- **Shots canvas** (scene projects): the storyboard — numbered 16:9 cards on a pannable grid, live status per shot, hover "+" between cards to insert a transition, double-click for shot detail.
- **Action scene maker**: dockable/floating panel with the plan review, live run feed, escalation cards, and a chat line that answers questions about the scene state.
- **Preview + prompt bar**: asset viewer and image palette; mark any image as **Start frame (A)** / **End frame (B)**; ✦ Frame A / ✦ Frame B / ✦ Video prompt write editable, autosaving prompts. The INPUTS rail shows exactly what will be sent to the generator — scoped to a shot, it shows the exact agent-loop inputs.
- **Sequence strip**: generated clips in order — drag to reorder, play all, download.
- **⤓ Export**: a zip of everything — inputs, per-shot frames and clips by version, and a `prompts.md` with the script, invariants, specs, and every prompt written along the way.

## Stack

- Next.js (App Router) on Vercel · Supabase (Postgres + Auth) · Vercel Blob (all media, app-owned URLs) · tldraw SDK (canvas) · zustand (state)
- LLMs: **grok-4.5** via the xAI API (planner, prompt writer, scene translation, production agent) · **Claude Sonnet** via the Anthropic API (scene judge + fix rewriter — an independent model from the builder; falls back to grok if unset)
- Image: **Nano Banana Pro** (`fal-ai/gemini-3-pro-image-preview/edit`), **Nano Banana 2** (`fal-ai/nano-banana-2/edit`)
- Video: **Grok Imagine 1.5** i2v 480/720/1080p, **Kling 3 Pro** start+end frames, Kling 3 Pro motion control (guide video), **Seedance 2.0** start+end frames, **Seedance 2.0 Fast** multi-reference + video input
- Segmentation: **SAM 3.1** (`fal-ai/sam-3-1/image` — text, point, and box prompts; per-instance masks)

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

Optional:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the independent Claude judge/fixer for scene runs (grok fallback without it) |

The legacy `SUPABASE_ANON_KEY` / `SERVICE_ROLE_KEY` / `JWT_SECRET` fields are **not needed** — this app uses the new publishable/secret API keys.

### Supabase auth configuration (one-time, in the dashboard)

1. **Authentication → URL Configuration**: set Site URL to `http://localhost:3001` (add your production URL after deploy) and add `http://localhost:3001/**` to Redirect URLs.
2. **Authentication → Email Templates → Confirm signup**: change the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   (required for the server-side confirm flow in `src/app/auth/confirm/route.ts`).

### Database

Migrations live in `supabase/migrations/`. They have already been applied to the linked project; to re-apply elsewhere use the Supabase SQL editor or `supabase db push`.

## Roadmap (pipeline is built to be aware of these)

- **End frames in the auto-loop**: the judge/fix loop currently covers start frames; frame-B generation and a judge pass over generated *clips* come next.
- **Shot framing / 360° camera**: stickers + empty plate + instance atlas form a world package ready to be lifted into an explorable 3-D blocking view (SAM 3 3D-objects is earmarked for this), plus drawn camera trajectories.
- **Canvas animation → guide video**: record object motion on the canvas as a video input for motion-control / video-input models.
- Multi-image location paths drawn across a larger map; agent-driven canvas blocking when the judge suggests it; Google OAuth; payments.

## Credits caution

fal credits are limited. Nothing generates without an explicit click or confirmation: scene runs sit behind a plan-approval gate, end frames and videos behind their own confirmations, and the judge/fix loop has a hard cap on automatic retries. A judge failure that cites no failed checks counts as a pass — an inconsistent verdict never burns credits.
