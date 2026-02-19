import type {
  ApiMode,
  LegoTaskParams,
  CompletionRequest,
  CompletionContentPart,
  CompletionResponse,
  ApiEnvelope,
  ReleaseTaskResponse,
  TaskResultEntry,
  ModelsListResponse,
  StatsResponse,
} from '../types/api';

const API_BASE = '/api';

// --- API config (stored server-side, accessed via dev endpoint) ---

export async function getApiConfig(): Promise<{ url: string; hasKey: boolean; mode: ApiMode }> {
  const res = await fetch('/__api-config');
  return res.json();
}

export async function saveApiConfig(
  url: string,
  key: string | undefined,
  mode?: ApiMode,
): Promise<{ url: string; hasKey: boolean; mode: ApiMode }> {
  const res = await fetch('/__api-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key, mode }),
  });
  return res.json();
}

// --- ACE-Step API calls (always through /api proxy) ---

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

// --- Completion mode ---

export interface CompletionResult {
  audioBlob: Blob;
  metadata: {
    bpm?: number;
    keyScale?: string;
    timeSignature?: string;
    genres?: string;
  };
}

/**
 * Generate audio via the completion API (/v1/chat/completions).
 * Returns the cumulative audio blob and any parsed metadata.
 */
export async function generateCompletion(opts: {
  model: string;
  prompt: string;
  lyrics: string;
  taskType: string;
  srcAudioBlob: Blob | null;
  repaintingStart: number;
  repaintingEnd: number;
  duration: number;
  bpm: number | null;
  keyScale: string;
  timeSignature: string;
  thinking: boolean;
  sampleMode?: boolean;
  useCotCaption?: boolean;
}): Promise<CompletionResult> {
  // Build content parts
  const parts: CompletionContentPart[] = [];

  // If we have source audio (for lego), encode as base64 input_audio
  if (opts.srcAudioBlob && opts.taskType === 'lego') {
    const arrayBuffer = await opts.srcAudioBlob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );
    parts.push({
      type: 'input_audio',
      input_audio: { data: base64, format: 'wav' },
    });
  }

  // Text content: prompt + lyrics
  let text = opts.prompt;
  if (opts.lyrics) {
    text += `\n\n[Lyrics]\n${opts.lyrics}`;
  }
  parts.push({ type: 'text', text });

  const body: CompletionRequest = {
    model: opts.model,
    messages: [{ role: 'user', content: parts }],
    stream: false,
    thinking: opts.thinking,
    task_type: opts.taskType,
    repainting_start: opts.repaintingStart,
    repainting_end: opts.repaintingEnd,
    batch_size: 1,
    audio_config: {
      duration: opts.duration,
      format: 'wav',
      bpm: opts.bpm ?? undefined,
      key_scale: opts.keyScale || undefined,
      time_signature: opts.timeSignature || undefined,
    },
  };

  if (opts.sampleMode) body.sample_mode = true;
  if (opts.useCotCaption === false) body.use_cot_caption = false;

  // 10-minute timeout for long generations
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Completion API failed: ${res.status} - ${text}`);
    }

    const data: CompletionResponse = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No choices in completion response');

    // Extract audio from response
    const audioEntry = choice.message.audio?.[0];
    if (!audioEntry) throw new Error('No audio in completion response');

    const audioUrl = audioEntry.audio_url.url;
    const audioBlob = decodeBase64DataUrl(audioUrl);

    // Parse metadata from content markdown
    const metadata = parseCompletionMetadata(choice.message.content);

    return { audioBlob, metadata };
  } finally {
    clearTimeout(timeout);
  }
}

/** Decode a base64 data URL (data:audio/wav;base64,...) to a Blob. */
function decodeBase64DataUrl(dataUrl: string): Blob {
  // Handle both "data:audio/wav;base64,..." and raw base64
  let mimeType = 'audio/wav';
  let base64 = dataUrl;

  if (dataUrl.startsWith('data:')) {
    const [header, payload] = dataUrl.split(',', 2);
    const mimeMatch = header.match(/^data:([^;]+)/);
    if (mimeMatch) mimeType = mimeMatch[1];
    base64 = payload;
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** Parse BPM, key, etc. from the markdown content returned by the completion API. */
function parseCompletionMetadata(content: string): CompletionResult['metadata'] {
  const metadata: CompletionResult['metadata'] = {};
  if (!content) return metadata;

  const bpmMatch = content.match(/\bbpm\s*[=:]\s*(\d+)/i);
  if (bpmMatch) metadata.bpm = parseInt(bpmMatch[1], 10);

  const keyMatch = content.match(/\bkey(?:_scale)?\s*[=:]\s*([A-G][#b]?\s*(?:major|minor|maj|min)?)/i);
  if (keyMatch) metadata.keyScale = keyMatch[1].trim();

  const tsMatch = content.match(/\btime(?:_signature)?\s*[=:]\s*([\d/]+)/i);
  if (tsMatch) metadata.timeSignature = tsMatch[1];

  const genreMatch = content.match(/\bgenres?\s*[=:]\s*([^\n]+)/i);
  if (genreMatch) metadata.genres = genreMatch[1].trim();

  return metadata;
}
