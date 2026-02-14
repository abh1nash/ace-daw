import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../store/projectStore';
import { useGenerationStore } from '../store/generationStore';
import type { LegoTaskParams, TaskResultItem } from '../types/api';
import type { InferredMetas } from '../types/project';
import * as api from './aceStepApi';
import { generateSilenceWav } from './silenceGenerator';
import { saveAudioBlob, loadAudioBlobByKey } from './audioFileManager';
import { getAudioEngine } from '../hooks/useAudioEngine';
import { isolateTrackAudio } from '../engine/waveSubtraction';
import { audioBufferToWavBlob } from '../utils/wav';
import { computeWaveformPeaks } from '../utils/waveformPeaks';
import { POLL_INTERVAL_MS, MAX_POLL_DURATION_MS } from '../constants/defaults';

/**
 * Generate all tracks sequentially (bottom → top in generation order).
 */
export async function generateAllTracks(): Promise<void> {
  const { project, getTracksInGenerationOrder, updateClipStatus } = useProjectStore.getState();
  const genStore = useGenerationStore.getState();

  if (!project || genStore.isGenerating) return;
  genStore.setIsGenerating(true);

  try {
    const tracks = getTracksInGenerationOrder();
    let previousCumulativeBlob: Blob | null = null;

    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.generationStatus === 'ready') {
          // Already generated — use its cumulative mix as input for next track
          if (clip.cumulativeMixKey) {
            const blob = await loadAudioBlobByKey(clip.cumulativeMixKey);
            if (blob) previousCumulativeBlob = blob;
          }
          continue;
        }

        previousCumulativeBlob = await generateClipInternal(
          clip.id,
          previousCumulativeBlob,
        );
      }
    }
  } finally {
    useGenerationStore.getState().setIsGenerating(false);
  }
}

/**
 * Generate a single clip (and cascade if needed in the future).
 */
export async function generateSingleClip(clipId: string): Promise<void> {
  const genStore = useGenerationStore.getState();
  if (genStore.isGenerating) return;
  genStore.setIsGenerating(true);

  try {
    // Find the previous cumulative blob (from the track generated just before this one)
    const previousBlob = await getPreviousCumulativeBlob(clipId);
    await generateClipInternal(clipId, previousBlob);
  } finally {
    useGenerationStore.getState().setIsGenerating(false);
  }
}

async function getPreviousCumulativeBlob(clipId: string): Promise<Blob | null> {
  const { project, getTracksInGenerationOrder } = useProjectStore.getState();
  if (!project) return null;

  const tracks = getTracksInGenerationOrder();
  const clipTrack = tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!clipTrack) return null;

  // Find the track generated just before this one
  const trackIndex = tracks.indexOf(clipTrack);
  for (let i = trackIndex - 1; i >= 0; i--) {
    const prevTrack = tracks[i];
    // Get the last clip's cumulative mix
    for (let j = prevTrack.clips.length - 1; j >= 0; j--) {
      const prevClip = prevTrack.clips[j];
      if (prevClip.cumulativeMixKey) {
        return await loadAudioBlobByKey(prevClip.cumulativeMixKey) ?? null;
      }
    }
  }

  return null;
}

async function generateClipInternal(
  clipId: string,
  previousCumulativeBlob: Blob | null,
): Promise<Blob | null> {
  const store = useProjectStore.getState();
  const genStore = useGenerationStore.getState();
  const project = store.project;
  if (!project) return null;

  const clip = store.getClipById(clipId);
  const track = store.getTrackForClip(clipId);
  if (!clip || !track) return null;

  // Create generation job
  const jobId = uuidv4();
  genStore.addJob({
    id: jobId,
    clipId,
    trackName: track.trackName,
    status: 'queued',
    progress: 'Queued',
  });

  store.updateClipStatus(clipId, 'queued', { generationJobId: jobId });

  try {
    // Determine src_audio
    const srcAudioBlob = previousCumulativeBlob ?? generateSilenceWav(project.totalDuration);

    // Build instruction
    const instruction = `Generate the ${track.trackName.toUpperCase().replace('_', ' ')} track based on the audio context:`;

    // Build params — 'auto' = ACE-Step infers, null/undefined = project defaults, value = manual
    const resolvedBpm = clip.bpm === 'auto' ? null : (clip.bpm ?? project.bpm);
    const resolvedKey = clip.keyScale === 'auto' ? '' : (clip.keyScale ?? project.keyScale);
    const resolvedTimeSig = clip.timeSignature === 'auto' ? '' : String(clip.timeSignature ?? project.timeSignature);

    const params: LegoTaskParams = {
      task_type: 'lego',
      track_name: track.trackName,
      prompt: clip.prompt,
      lyrics: clip.lyrics || '',
      instruction,
      repainting_start: clip.startTime,
      repainting_end: clip.startTime + clip.duration,
      audio_duration: project.totalDuration,
      bpm: resolvedBpm,
      key_scale: resolvedKey,
      time_signature: resolvedTimeSig,
      inference_steps: project.generationDefaults.inferenceSteps,
      guidance_scale: project.generationDefaults.guidanceScale,
      shift: project.generationDefaults.shift,
      batch_size: 1,
      audio_format: 'wav',
      thinking: project.generationDefaults.thinking,
      model: project.generationDefaults.model || undefined,
    } as LegoTaskParams;

    // Sample mode: send prompt as sample_query
    if (clip.sampleMode) {
      params.sample_mode = true;
      params.sample_query = clip.prompt;
    }

    // Auto-expand prompt: controls whether LM rewrites the caption via CoT
    if (clip.autoExpandPrompt === false) {
      params.use_cot_caption = false;
    }

    // Submit task
    useGenerationStore.getState().updateJob(jobId, { status: 'generating', progress: 'Submitting...' });
    useProjectStore.getState().updateClipStatus(clipId, 'generating');

    const releaseResp = await api.releaseLegoTask(srcAudioBlob, params);
    const taskId = releaseResp.task_id;

    // Poll for completion
    const startTime = Date.now();
    let resultAudioPath: string | null = null;
    let firstResult: TaskResultItem | null = null;

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      await sleep(POLL_INTERVAL_MS);

      const entries = await api.queryResult([taskId]);
      const entry = entries?.[0];
      if (!entry) continue;

      useGenerationStore.getState().updateJob(jobId, {
        progress: entry.progress_text || 'Generating...',
      });

      if (entry.status === 1) {
        // Done — result is a JSON string containing an array of {file, ...}
        const resultItems: TaskResultItem[] = JSON.parse(entry.result);
        firstResult = resultItems?.[0] ?? null;
        resultAudioPath = firstResult?.file ?? null;
        break;
      } else if (entry.status === 2) {
        throw new Error(`Generation failed: ${entry.result}`);
      }
      // status 0 = still processing
    }

    if (!resultAudioPath) {
      throw new Error('Generation timed out');
    }

    // Download audio
    useGenerationStore.getState().updateJob(jobId, { status: 'processing', progress: 'Downloading audio...' });
    useProjectStore.getState().updateClipStatus(clipId, 'processing');

    const cumulativeBlob = await api.downloadAudio(resultAudioPath);

    // Store cumulative mix
    const cumulativeKey = await saveAudioBlob(project.id, clipId, 'cumulative', cumulativeBlob);

    // Wave subtraction: isolate this track
    const engine = getAudioEngine();
    const cumulativeBuffer = await engine.decodeAudioData(cumulativeBlob);

    let previousBuffer: AudioBuffer | null = null;
    if (previousCumulativeBlob) {
      previousBuffer = await engine.decodeAudioData(previousCumulativeBlob);
    }

    const fullIsolatedBuffer = isolateTrackAudio(engine.ctx, cumulativeBuffer, previousBuffer);

    // Re-read clip from store in case the user moved/resized it during generation
    const currentClip = useProjectStore.getState().getClipById(clipId);
    const clipStart = currentClip?.startTime ?? clip.startTime;
    const clipDuration = currentClip?.duration ?? clip.duration;

    // Trim isolated audio to just the clip's time region so the buffer
    // represents only the clip's audio (not the full project duration).
    const sampleRate = fullIsolatedBuffer.sampleRate;
    const startSample = Math.floor(clipStart * sampleRate);
    const endSample = Math.min(
      Math.floor((clipStart + clipDuration) * sampleRate),
      fullIsolatedBuffer.length,
    );
    const trimmedLength = Math.max(1, endSample - startSample);
    const trimmedBuffer = engine.ctx.createBuffer(
      fullIsolatedBuffer.numberOfChannels,
      trimmedLength,
      sampleRate,
    );
    for (let ch = 0; ch < fullIsolatedBuffer.numberOfChannels; ch++) {
      const src = fullIsolatedBuffer.getChannelData(ch);
      const dst = trimmedBuffer.getChannelData(ch);
      for (let i = 0; i < trimmedLength; i++) {
        dst[i] = src[startSample + i];
      }
    }

    const isolatedBlob = audioBufferToWavBlob(trimmedBuffer);
    const isolatedKey = await saveAudioBlob(project.id, clipId, 'isolated', isolatedBlob);

    // Compute waveform peaks from the trimmed buffer (full buffer = clip region)
    const peaks = computeWaveformPeaks(trimmedBuffer, 200);

    // Build inferred metadata from result
    const inferredMetas: InferredMetas | undefined = firstResult
      ? {
          bpm: firstResult.metas?.bpm,
          keyScale: firstResult.metas?.keyscale,
          timeSignature: firstResult.metas?.timesignature,
          genres: firstResult.metas?.genres,
          seed: firstResult.seed_value,
          ditModel: firstResult.dit_model,
        }
      : undefined;

    // Update clip as ready
    useProjectStore.getState().updateClipStatus(clipId, 'ready', {
      cumulativeMixKey: cumulativeKey,
      isolatedAudioKey: isolatedKey,
      waveformPeaks: peaks,
      inferredMetas,
      audioDuration: clipDuration,
      audioOffset: 0,
    });

    useGenerationStore.getState().updateJob(jobId, { status: 'done', progress: 'Done' });

    return cumulativeBlob;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    useProjectStore.getState().updateClipStatus(clipId, 'error', { errorMessage: message });
    useGenerationStore.getState().updateJob(jobId, { status: 'error', progress: message, error: message });
    return previousCumulativeBlob;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
