import { useProjectStore } from '../../store/projectStore';
import { useUIStore } from '../../store/uiStore';

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const setShowNewProjectDialog = useUIStore((s) => s.setShowNewProjectDialog);
  const setShowSettingsDialog = useUIStore((s) => s.setShowSettingsDialog);
  const setShowExportDialog = useUIStore((s) => s.setShowExportDialog);
  const setShowProjectListDialog = useUIStore((s) => s.setShowProjectListDialog);

  return (
    <div className="flex items-center h-10 px-3 gap-2 bg-daw-surface border-b border-daw-border">
      <button
        onClick={() => setShowProjectListDialog(true)}
        className="px-3 py-1 text-xs font-medium bg-daw-surface-2 hover:bg-zinc-600 rounded transition-colors"
      >
        Projects
      </button>
      <button
        onClick={() => setShowNewProjectDialog(true)}
        className="px-3 py-1 text-xs font-medium bg-daw-surface-2 hover:bg-zinc-600 rounded transition-colors"
      >
        New
      </button>
      <button
        onClick={() => setShowExportDialog(true)}
        className="px-3 py-1 text-xs font-medium bg-daw-surface-2 hover:bg-zinc-600 rounded transition-colors"
        disabled={!project}
      >
        Export
      </button>

      <div className="flex-1 text-center">
        <span className="text-sm font-medium text-zinc-300">
          {project?.name ?? 'ACE-Step DAW'}
        </span>
      </div>

      <button
        onClick={() => setShowSettingsDialog(true)}
        className="px-3 py-1 text-xs font-medium bg-daw-surface-2 hover:bg-zinc-600 rounded transition-colors"
      >
        Settings
      </button>
    </div>
  );
}
