import { useState, useEffect, useRef } from 'react';
import type { ApiMode } from '../../types/api';
import { healthCheck, getApiConfig, saveApiConfig } from '../../services/aceStepApi';
import { useGenerationStore } from '../../store/generationStore';
import { useProjectStore } from '../../store/projectStore';

function ApiSettingsPopover({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<ApiMode>('completion');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getApiConfig()
      .then((cfg) => {
        setUrl(cfg.url);
        setKey(cfg.hasKey ? '••••••••' : '');
        setMode(cfg.mode ?? 'completion');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSave = async () => {
    // Only send key if user actually typed a new one (not the masked placeholder)
    const keyToSend = key === '••••••••' ? undefined : key.trim();
    await saveApiConfig(url, keyToSend as string, mode);
    onSaved();
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-7 right-2 w-80 bg-daw-surface border border-daw-border rounded-lg shadow-2xl z-50"
    >
      <div className="px-3 py-2 border-b border-daw-border flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">API Settings</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-sm leading-none">×</button>
      </div>
      {loading ? (
        <div className="p-3 text-xs text-zinc-500">Loading...</div>
      ) : (
        <div className="p-3 space-y-2.5">
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">API URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.acemusic.ai"
              className="w-full px-2 py-1 text-xs bg-daw-bg border border-daw-border rounded focus:outline-none focus:border-daw-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">API Key</label>
            <div className="flex gap-1.5">
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onFocus={() => { if (key === '••••••••') setKey(''); }}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter API key"
                className="flex-1 px-2 py-1 text-xs bg-daw-bg border border-daw-border rounded focus:outline-none focus:border-daw-accent"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 bg-daw-bg border border-daw-border rounded transition-colors"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1 text-[9px] text-zinc-600">
              Free key at acemusic.ai/api-key
            </p>
          </div>
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">API Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ApiMode)}
              className="w-full px-2 py-1 text-xs bg-daw-bg border border-daw-border rounded focus:outline-none focus:border-daw-accent text-zinc-300"
            >
              <option value="completion">Completion (Cloud)</option>
              <option value="native">Native (Local)</option>
            </select>
          </div>
          <button
            onClick={handleSave}
            className="w-full py-1 text-xs font-medium bg-daw-accent hover:bg-daw-accent-hover text-white rounded transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export function StatusBar() {
  const [connected, setConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const jobs = useGenerationStore((s) => s.jobs);
  const activeJobs = jobs.filter((j) => j.status === 'generating' || j.status === 'queued');
  const model = useProjectStore((s) => s.project?.generationDefaults.model);

  const runHealthCheck = async () => {
    const ok = await healthCheck();
    setConnected(ok);
  };

  useEffect(() => {
    let active = true;
    const check = async () => {
      const ok = await healthCheck();
      if (active) setConnected(ok);
    };
    check();
    const interval = setInterval(check, 10000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return (
    <div className="relative flex items-center h-6 px-3 gap-4 bg-daw-surface border-t border-daw-border text-[11px] text-zinc-500">
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`}
        />
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <span>{model || 'Server Default'}</span>
      {activeJobs.length > 0 && (
        <span>Queue: {activeJobs.length}</span>
      )}
      <div className="ml-auto">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-1 px-1.5 py-0.5 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.9 1.7a1.2 1.2 0 0 1 2.2 0l.3.8a1.2 1.2 0 0 0 1.5.7l.8-.3a1.2 1.2 0 0 1 1.5 1.5l-.3.8a1.2 1.2 0 0 0 .7 1.5l.8.3a1.2 1.2 0 0 1 0 2.2l-.8.3a1.2 1.2 0 0 0-.7 1.5l.3.8a1.2 1.2 0 0 1-1.5 1.5l-.8-.3a1.2 1.2 0 0 0-1.5.7l-.3.8a1.2 1.2 0 0 1-2.2 0l-.3-.8a1.2 1.2 0 0 0-1.5-.7l-.8.3a1.2 1.2 0 0 1-1.5-1.5l.3-.8a1.2 1.2 0 0 0-.7-1.5l-.8-.3a1.2 1.2 0 0 1 0-2.2l.8-.3a1.2 1.2 0 0 0 .7-1.5l-.3-.8A1.2 1.2 0 0 1 4.3 2.2l.8.3a1.2 1.2 0 0 0 1.5-.7z" />
            <circle cx="8" cy="8" r="2.5" />
          </svg>
          <span>API</span>
        </button>
      </div>
      {showSettings && (
        <ApiSettingsPopover
          onClose={() => setShowSettings(false)}
          onSaved={runHealthCheck}
        />
      )}
    </div>
  );
}
