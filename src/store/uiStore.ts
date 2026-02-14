import { create } from 'zustand';

interface UIState {
  pixelsPerSecond: number;
  scrollX: number;
  scrollY: number;
  selectedClipIds: Set<string>;
  editingClipId: string | null;
  showNewProjectDialog: boolean;
  showInstrumentPicker: boolean;
  showExportDialog: boolean;
  showSettingsDialog: boolean;
  showProjectListDialog: boolean;

  setPixelsPerSecond: (pps: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setScrollX: (x: number) => void;
  setScrollY: (y: number) => void;
  selectClip: (clipId: string, multi?: boolean) => void;
  deselectAll: () => void;
  setEditingClip: (clipId: string | null) => void;
  setShowNewProjectDialog: (v: boolean) => void;
  setShowInstrumentPicker: (v: boolean) => void;
  setShowExportDialog: (v: boolean) => void;
  setShowSettingsDialog: (v: boolean) => void;
  setShowProjectListDialog: (v: boolean) => void;
}

const ZOOM_LEVELS = [10, 25, 50, 100, 200, 500];

export const useUIStore = create<UIState>((set) => ({
  pixelsPerSecond: 50,
  scrollX: 0,
  scrollY: 0,
  selectedClipIds: new Set(),
  editingClipId: null,
  showNewProjectDialog: false,
  showInstrumentPicker: false,
  showExportDialog: false,
  showSettingsDialog: false,
  showProjectListDialog: false,

  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: pps }),

  zoomIn: () =>
    set((s) => {
      const idx = ZOOM_LEVELS.findIndex((z) => z >= s.pixelsPerSecond);
      const next = idx < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[idx + 1] : s.pixelsPerSecond;
      return { pixelsPerSecond: next };
    }),

  zoomOut: () =>
    set((s) => {
      const idx = ZOOM_LEVELS.findIndex((z) => z >= s.pixelsPerSecond);
      const prev = idx > 0 ? ZOOM_LEVELS[idx - 1] : s.pixelsPerSecond;
      return { pixelsPerSecond: prev };
    }),

  setScrollX: (x) => set({ scrollX: x }),
  setScrollY: (y) => set({ scrollY: y }),

  selectClip: (clipId, multi) =>
    set((s) => {
      if (multi) {
        const next = new Set(s.selectedClipIds);
        if (next.has(clipId)) next.delete(clipId);
        else next.add(clipId);
        return { selectedClipIds: next };
      }
      return { selectedClipIds: new Set([clipId]) };
    }),

  deselectAll: () => set({ selectedClipIds: new Set() }),

  setEditingClip: (clipId) => set({ editingClipId: clipId }),
  setShowNewProjectDialog: (v) => set({ showNewProjectDialog: v }),
  setShowInstrumentPicker: (v) => set({ showInstrumentPicker: v }),
  setShowExportDialog: (v) => set({ showExportDialog: v }),
  setShowSettingsDialog: (v) => set({ showSettingsDialog: v }),
  setShowProjectListDialog: (v) => set({ showProjectListDialog: v }),
}));
