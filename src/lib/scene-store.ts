import { create } from "zustand";
import type { Shot } from "./types";

export type SceneView = "shots" | "fixit";

export type ScenePhase =
  | "idle"
  | "planning"
  | "awaiting-approval"
  | "running"
  | "paused"
  | "done";

export interface SceneAgentEvent {
  ts: number;
  shotId?: string;
  kind:
    | "info"
    | "plan"
    | "gen"
    | "verdict"
    | "fix"
    | "escalate"
    | "error"
    | "user"
    | "chat";
  text: string;
  imageUrl?: string;
}

interface SceneAgentState {
  /** Which tab of a scene project is visible. */
  view: SceneView;
  /** Selected shot on the shots canvas; scopes the fix-it view when set. */
  activeShotId: string | null;
  shots: Shot[];
  phase: ScenePhase;
  events: SceneAgentEvent[];
  panelOpen: boolean;

  setView: (view: SceneView) => void;
  setActiveShot: (id: string | null) => void;
  setShots: (shots: Shot[]) => void;
  patchShotLocal: (id: string, patch: Partial<Shot>) => void;
  addShots: (shots: Shot[]) => void;
  removeShot: (id: string) => void;
  setPhase: (phase: ScenePhase) => void;
  pushEvent: (e: Omit<SceneAgentEvent, "ts">) => void;
  clearEvents: () => void;
  setPanelOpen: (open: boolean) => void;
  resetScene: () => void;
}

const sortShots = (shots: Shot[]) =>
  [...shots].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
  );

export const useSceneAgent = create<SceneAgentState>((set) => ({
  view: "shots",
  activeShotId: null,
  shots: [],
  phase: "idle",
  events: [],
  panelOpen: false,

  setView: (view) => set({ view }),
  setActiveShot: (activeShotId) => set({ activeShotId }),
  setShots: (shots) => set({ shots: sortShots(shots) }),
  patchShotLocal: (id, patch) =>
    set((s) => ({
      shots: sortShots(
        s.shots.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh))
      ),
    })),
  addShots: (newShots) =>
    set((s) => ({ shots: sortShots([...s.shots, ...newShots]) })),
  removeShot: (id) =>
    set((s) => ({
      shots: s.shots.filter((sh) => sh.id !== id),
      activeShotId: s.activeShotId === id ? null : s.activeShotId,
    })),
  setPhase: (phase) => set({ phase }),
  pushEvent: (e) =>
    set((s) => ({ events: [...s.events, { ...e, ts: Date.now() }] })),
  clearEvents: () => set({ events: [] }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  resetScene: () =>
    set({
      view: "shots",
      activeShotId: null,
      shots: [],
      phase: "idle",
      events: [],
      panelOpen: false,
    }),
}));
