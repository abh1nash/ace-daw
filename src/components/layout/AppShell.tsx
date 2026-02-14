import { useEffect, useCallback } from 'react';
import { Toolbar } from './Toolbar';
import { StatusBar } from './StatusBar';
import { TransportBar } from '../transport/TransportBar';
import { TrackList } from '../tracks/TrackList';
import { Timeline } from '../timeline/Timeline';
import { GenerationPanel } from '../generation/GenerationPanel';
import { ClipPromptEditor } from '../generation/ClipPromptEditor';
import { NewProjectDialog } from '../dialogs/NewProjectDialog';
import { InstrumentPicker } from '../dialogs/InstrumentPicker';
import { ExportDialog } from '../dialogs/ExportDialog';
import { SettingsDialog } from '../dialogs/SettingsDialog';
import { ProjectListDialog } from '../dialogs/ProjectListDialog';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useProjectStore } from '../../store/projectStore';
import { useUIStore } from '../../store/uiStore';
import { useTransport } from '../../hooks/useTransport';

export function AppShell() {
  const { resumeOnGesture } = useAudioEngine();
  const project = useProjectStore((s) => s.project);
  const setShowNewProjectDialog = useUIStore((s) => s.setShowNewProjectDialog);
  const { isPlaying, play, pause, stop } = useTransport();

  // Resume AudioContext on first user interaction
  const handleClick = useCallback(() => {
    resumeOnGesture();
  }, [resumeOnGesture]);

  // Show new project dialog on first load if no project
  useEffect(() => {
    if (!project) {
      setShowNewProjectDialog(true);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (isPlaying) pause();
          else play();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPlaying, play, pause, stop]);

  return (
    <div className="flex flex-col h-screen" onClick={handleClick}>
      <Toolbar />
      <TransportBar />

      <div className="flex flex-1 min-h-0">
        {project && <TrackList />}
        <Timeline />
      </div>

      {project && <GenerationPanel />}
      <StatusBar />

      {/* Modals */}
      <ClipPromptEditor />
      <NewProjectDialog />
      <InstrumentPicker />
      <ExportDialog />
      <SettingsDialog />
      <ProjectListDialog />
    </div>
  );
}
