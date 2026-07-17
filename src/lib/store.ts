import { create } from "zustand";
import type { Asset, Element, Project } from "./types";

interface WorkspaceState {
  project: Project | null;
  elements: Element[];
  assets: Asset[];
  /** Asset shown in the preview panel */
  selectedAssetId: string | null;
  /** Frames picked for video generation */
  startFrameId: string | null;
  endFrameId: string | null;
  agentOpen: boolean;
  busy: string | null;

  setProject: (p: Project | null) => void;
  patchProject: (patch: Partial<Project>) => void;
  setElements: (e: Element[]) => void;
  setAssets: (a: Asset[]) => void;
  addAssets: (a: Asset[]) => void;
  removeAsset: (id: string) => void;
  select: (id: string | null) => void;
  setStartFrame: (id: string | null) => void;
  setEndFrame: (id: string | null) => void;
  setAgentOpen: (open: boolean) => void;
  setBusy: (b: string | null) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  project: null,
  elements: [],
  assets: [],
  selectedAssetId: null,
  startFrameId: null,
  endFrameId: null,
  agentOpen: false,
  busy: null,

  setProject: (project) => set({ project }),
  patchProject: (patch) =>
    set((s) => ({ project: s.project ? { ...s.project, ...patch } : null })),
  setElements: (elements) => set({ elements }),
  setAssets: (assets) => set({ assets }),
  addAssets: (newAssets) =>
    set((s) => ({
      assets: [...s.assets, ...newAssets],
      selectedAssetId: newAssets[newAssets.length - 1]?.id ?? s.selectedAssetId,
    })),
  removeAsset: (id) =>
    set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),
  select: (selectedAssetId) => set({ selectedAssetId }),
  setStartFrame: (startFrameId) => set({ startFrameId }),
  setEndFrame: (endFrameId) => set({ endFrameId }),
  setAgentOpen: (agentOpen) => set({ agentOpen }),
  setBusy: (busy) => set({ busy }),
}));
