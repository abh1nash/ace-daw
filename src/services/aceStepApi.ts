import type {
  LegoTaskParams,
  ApiEnvelope,
  ReleaseTaskResponse,
  TaskResultEntry,
  ModelsListResponse,
  StatsResponse,
} from '../types/api';

const API_BASE = '/api';

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<ModelsListResponse> {
  const res = await fetch(`${API_BASE}/v1/models`);
  if (!res.ok) throw new Error(`listModels failed: ${res.status}`);
  const envelope: ApiEnvelope<ModelsListResponse> = await res.json();
  return envelope.data;
}

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/v1/stats`);
  if (!res.ok) throw new Error(`getStats failed: ${res.status}`);
  const envelope: ApiEnvelope<StatsResponse> = await res.json();
  return envelope.data;
}

export async function releaseLegoTask(
  srcAudioBlob: Blob,
  params: LegoTaskParams,
): Promise<ReleaseTaskResponse> {
  const formData = new FormData();

  // Add the audio file
  formData.append('src_audio', srcAudioBlob, 'src_audio.wav');

  // Add all params as form fields (skip null values — ACE-Step auto-infers them)
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    formData.append(key, String(value));
  }

  const res = await fetch(`${API_BASE}/release_task`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`releaseLegoTask failed: ${res.status} - ${text}`);
  }

  const envelope: ApiEnvelope<ReleaseTaskResponse> = await res.json();
  return envelope.data;
}

export async function queryResult(taskIds: string[]): Promise<TaskResultEntry[]> {
  const res = await fetch(`${API_BASE}/query_result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id_list: taskIds }),
  });

  if (!res.ok) throw new Error(`queryResult failed: ${res.status}`);
  const envelope: ApiEnvelope<TaskResultEntry[]> = await res.json();
  return envelope.data;
}

export async function downloadAudio(audioPath: string): Promise<Blob> {
  // The file field from query_result may already be a full URL path like
  // "/v1/audio?path=%2FUsers%2F..." — use it directly via the proxy.
  // Or it may be a bare filesystem path — construct the URL ourselves.
  let url: string;
  if (audioPath.startsWith('/v1/')) {
    url = `${API_BASE}${audioPath}`;
  } else {
    url = `${API_BASE}/v1/audio?path=${encodeURIComponent(audioPath)}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`downloadAudio failed: ${res.status} ${res.statusText}`);
  return res.blob();
}
