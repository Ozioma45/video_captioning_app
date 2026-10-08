import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  computeWhisperTimeoutMs,
  WHISPER_BEAM_SIZE,
  WHISPER_BEST_OF,
  WHISPER_BINARY_PATH,
  WHISPER_CHUNK_DURATION_SECONDS,
  WHISPER_LANGUAGE,
  WHISPER_MODEL_PATH,
  WHISPER_THREADS,
} from "@/config/whisper";
import type { CancellableProcessHandle, TranscriptionInput, TranscriptionResult } from "@/types";
import type { TranscriptionProvider } from "./TranscriptionService";
import { buildWhisperArgs } from "./buildWhisperArgs";
import { mergeChunkedTranscriptionResults } from "./mergeChunkedTranscription";
import { parseWhisperCppOutput, type WhisperCppOutput } from "./parseWhisperCppOutput";
import { planAudioChunks } from "./planAudioChunks";
import { runManagedWhisperProcess } from "./runManagedWhisperProcess";
import { sliceWavBuffer, wavDurationSeconds } from "./wavSlicing";
import {
  classifyWhisperExecError,
  MalformedTranscriptionResultError,
  WhisperBinaryMissingError,
  WhisperCancelledError,
  WhisperModelMissingError,
  WhisperTimeoutError,
} from "./errors";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Real filesystem check, exported standalone so the job runner can fail
 * fast *before* spending time extracting audio for a transcription that
 * can never run (see runTranscriptionJob.ts) — not just internally
 * inside `transcribe()`, which still calls this too so the provider is
 * safe to use on its own (e.g. directly in a test) without relying on a
 * caller to pre-check.
 */
export async function assertWhisperConfigured(): Promise<void> {
  if (!WHISPER_BINARY_PATH) throw new WhisperBinaryMissingError();
  if (!(await fileExists(WHISPER_BINARY_PATH))) throw new WhisperBinaryMissingError();

  if (!WHISPER_MODEL_PATH) throw new WhisperModelMissingError();
  if (!(await fileExists(WHISPER_MODEL_PATH))) throw new WhisperModelMissingError();
}

/** A short, log-safe log line prefix correlating this run without ever including transcript content. */
function logPrefix(jobId: string | undefined): string {
  return `[whisper.cpp]${jobId ? ` job=${jobId}` : ""}`;
}

interface SingleInvocationOptions {
  /** Logged alongside progress/completion, e.g. "chunk 2/6" — omitted for a non-chunked run. */
  label?: string;
  onProgress?: (percent: number) => void;
  onProcessStart?: (handle: CancellableProcessHandle) => void;
}

/**
 * `TranscriptionProvider` backed by a local whisper.cpp binary (confirmed
 * Phase 0 decision; ARCHITECTURE.md §6). All whisper.cpp-specific
 * argument/output-format knowledge lives in this file,
 * `buildWhisperArgs.ts` and `parseWhisperCppOutput.ts` — nothing outside
 * `services/transcription/` ever sees whisper's raw JSON shape (CLAUDE.md
 * "keep processing logic separate from UI" / provider-abstraction
 * requirement).
 *
 * Invoked via `spawn` with an argument array, never a shell string
 * (CLAUDE.md, Phase 2 incident). Binary/model paths come from
 * `config/whisper.ts` (environment-driven, never hard-coded) and are
 * checked with a real filesystem access *before* spawning anything, so a
 * missing setup fails as a clear configuration error rather than an
 * opaque process failure (Phase 3 brief §2).
 *
 * Process lifecycle (spawn/timeout/cancel/progress) lives in
 * `runManagedWhisperProcess.ts`; this class builds the arguments, computes
 * the effective (duration-aware) timeout, logs safe diagnostics, and
 * reads back the result.
 *
 * **Long-audio chunking** (2026-10-04): audio longer than
 * `WHISPER_CHUNK_DURATION_SECONDS` is split into independent whisper.cpp
 * invocations (`planAudioChunks` + `wavSlicing.ts`), run sequentially and
 * merged back into one result (`mergeChunkedTranscription.ts`). Root
 * cause and benchmark data: `config/whisper.ts`'s
 * `WHISPER_CHUNK_DURATION_SECONDS` doc comment and
 * ARCHITECTURE.md's Whisper reliability notes. Audio at or below the
 * chunk threshold runs exactly as a single invocation always has —
 * this is a strict addition, not a behavior change, for anything short.
 */
export class WhisperCppTranscriptionProvider implements TranscriptionProvider {
  readonly id = "local-whisper-cpp" as const;

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    await assertWhisperConfigured();

    const overallDurationSeconds = input.durationSeconds ?? (await this.measureAudioDurationSafely(input.audioFilePath));
    const overallTimeoutMs = computeWhisperTimeoutMs(overallDurationSeconds);

    console.log(
      `${logPrefix(input.jobId)} starting: audioDurationSeconds=${overallDurationSeconds}`,
      `model=${path.basename(WHISPER_MODEL_PATH ?? "unknown")} threads=${WHISPER_THREADS}`,
      `beamSize=${WHISPER_BEAM_SIZE ?? "default"} bestOf=${WHISPER_BEST_OF ?? "default"} timeoutMs=${overallTimeoutMs}`,
    );

    if (overallDurationSeconds <= WHISPER_CHUNK_DURATION_SECONDS) {
      return this.runSingleInvocation(input, input.audioFilePath, overallDurationSeconds, overallTimeoutMs, {
        onProgress: input.onProgress,
        onProcessStart: input.onProcessStart,
      });
    }

    return this.transcribeInChunks(input, overallDurationSeconds, overallTimeoutMs);
  }

  /**
   * Splits long audio into `WHISPER_CHUNK_DURATION_SECONDS`-sized pieces,
   * transcribes each as its own fresh invocation, and merges the results
   * with each chunk's start-time offset added back in — real word-level
   * timestamps are preserved exactly, never re-estimated (CLAUDE.md
   * "preserve word-level timestamps").
   *
   * Two timeouts bound the job: each chunk gets its own duration-aware
   * timeout (computed exactly like a single invocation's, just for that
   * chunk's shorter length), AND an overall deadline derived from the
   * full audio's own timeout keeps the *whole* job from running longer
   * than a non-chunked transcription of the same length ever could —
   * whichever is tighter wins for the chunk about to run, so one chunk
   * being newly, unexpectedly slow fails fast instead of silently eating
   * the entire remaining budget.
   */
  private async transcribeInChunks(
    input: TranscriptionInput,
    totalDurationSeconds: number,
    overallTimeoutMs: number,
  ): Promise<TranscriptionResult> {
    const audioBuffer = await readFile(input.audioFilePath);
    const wavDuration = this.safeWavDuration(audioBuffer) ?? totalDurationSeconds;
    const plan = planAudioChunks(wavDuration, WHISPER_CHUNK_DURATION_SECONDS);

    console.log(`${logPrefix(input.jobId)} splitting into ${plan.length} chunks of up to ${WHISPER_CHUNK_DURATION_SECONDS}s each`);

    const chunkDir = path.dirname(input.audioFilePath);
    const baseName = path.basename(input.audioFilePath).replace(/\.[^./\\]+$/, "");
    const overallDeadline = Date.now() + overallTimeoutMs;
    const startedAt = Date.now();
    let cancelled = false;

    const chunkResults: Array<{ result: TranscriptionResult; offsetSeconds: number }> = [];

    for (const chunk of plan) {
      if (cancelled) throw new WhisperCancelledError();
      if (Date.now() > overallDeadline) throw new WhisperTimeoutError(Date.now() - startedAt, overallTimeoutMs);

      const chunkDurationSeconds = chunk.endSeconds - chunk.startSeconds;
      const chunkPath = path.join(chunkDir, `${baseName}.chunk${chunk.index}.wav`);
      await writeFile(chunkPath, sliceWavBuffer(audioBuffer, chunk.startSeconds, chunk.endSeconds));

      const remainingOverallMs = Math.max(1000, overallDeadline - Date.now());
      const chunkTimeoutMs = Math.min(computeWhisperTimeoutMs(chunkDurationSeconds), remainingOverallMs);

      try {
        const result = await this.runSingleInvocation(input, chunkPath, chunkDurationSeconds, chunkTimeoutMs, {
          label: `chunk ${chunk.index + 1}/${plan.length}`,
          onProgress: input.onProgress
            ? (chunkPercent) => {
                const doneSeconds = chunk.startSeconds + (chunkPercent / 100) * chunkDurationSeconds;
                input.onProgress?.(Math.max(0, Math.min(100, Math.round((doneSeconds / wavDuration) * 100))));
              }
            : undefined,
          onProcessStart: input.onProcessStart
            ? (handle) => {
                input.onProcessStart?.({
                  cancel: () => {
                    cancelled = true;
                    handle.cancel();
                  },
                });
              }
            : undefined,
        });
        chunkResults.push({ result, offsetSeconds: chunk.startSeconds });
      } finally {
        await rm(chunkPath, { force: true }).catch(() => {});
      }
    }

    return mergeChunkedTranscriptionResults(chunkResults);
  }

  private async runSingleInvocation(
    input: TranscriptionInput,
    audioFilePath: string,
    durationSeconds: number,
    timeoutMs: number,
    options: SingleInvocationOptions,
  ): Promise<TranscriptionResult> {
    const outputBasename = audioFilePath.replace(/\.[^./\\]+$/, "");
    const outputJsonPath = `${outputBasename}.json`;

    try {
      await this.runWhisper(input, audioFilePath, outputBasename, timeoutMs, durationSeconds, options);
      const raw = await this.readOutput(outputJsonPath);
      return parseWhisperCppOutput(raw);
    } finally {
      await rm(outputJsonPath, { force: true }).catch(() => {});
    }
  }

  private async runWhisper(
    input: TranscriptionInput,
    audioFilePath: string,
    outputBasename: string,
    timeoutMs: number,
    durationSeconds: number,
    options: SingleInvocationOptions,
  ): Promise<void> {
    const label = options.label ? ` ${options.label}` : "";
    const args = buildWhisperArgs({
      modelPath: WHISPER_MODEL_PATH as string,
      audioFilePath,
      language: input.language || WHISPER_LANGUAGE,
      outputBasename,
      threads: WHISPER_THREADS,
      beamSize: WHISPER_BEAM_SIZE,
      bestOf: WHISPER_BEST_OF,
      reportProgress: options.onProgress !== undefined,
    });

    try {
      const { elapsedMs } = await runManagedWhisperProcess({
        binaryPath: WHISPER_BINARY_PATH as string,
        args,
        timeoutMs,
        onProgress: options.onProgress,
        onProcessStart: options.onProcessStart,
        onProcessEnd: ({ code, signal, alreadySettled }) => {
          console.log(
            `${logPrefix(input.jobId)}${label} process ended: code=${code ?? "null"} signal=${signal ?? "none"}`,
            alreadySettled ? "(after the outcome was already decided, e.g. a timeout kill)" : "",
          );
        },
      });
      console.log(`${logPrefix(input.jobId)}${label} completed in ${elapsedMs}ms`, this.describeSpeed(durationSeconds, elapsedMs));
    } catch (error) {
      if (error instanceof WhisperTimeoutError) {
        console.error(
          `${logPrefix(input.jobId)}${label} TIMED OUT after ${error.elapsedMs}ms (limit ${error.timeoutMs}ms) —`,
          `audioDurationSeconds=${durationSeconds}`,
        );
        throw error;
      }
      if (error instanceof WhisperCancelledError) {
        console.log(`${logPrefix(input.jobId)}${label} cancelled by request`);
        throw error;
      }

      const classified = classifyWhisperExecError(error);
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      console.error(
        `${logPrefix(input.jobId)}${label} ${classified.name} while transcribing ${audioFilePath}:`,
        `code=${nodeError.code ?? "unknown"}`,
        nodeError.stderr ? `stderr=${nodeError.stderr.slice(0, 500)}` : `message=${nodeError.message}`,
      );
      throw classified;
    }
  }

  /** e.g. "5.6x realtime" — audio duration vs. how long the process actually took. Diagnostics only. */
  private describeSpeed(durationSeconds: number | undefined, elapsedMs: number): string {
    if (!durationSeconds || durationSeconds <= 0 || elapsedMs <= 0) return "";
    const factor = (durationSeconds * 1000) / elapsedMs;
    return `(${factor.toFixed(1)}x realtime)`;
  }

  /** Only used when a caller doesn't supply `durationSeconds` (the real app always does) — reads the file to find out. */
  private async measureAudioDurationSafely(audioFilePath: string): Promise<number> {
    try {
      return this.safeWavDuration(await readFile(audioFilePath)) ?? 0;
    } catch {
      return 0;
    }
  }

  private safeWavDuration(buffer: Buffer): number | null {
    try {
      return wavDurationSeconds(buffer);
    } catch {
      return null;
    }
  }

  private async readOutput(outputJsonPath: string): Promise<WhisperCppOutput> {
    let text: string;
    try {
      text = await readFile(outputJsonPath, "utf-8");
    } catch (error) {
      throw new MalformedTranscriptionResultError("whisper.cpp did not produce an output file", error);
    }

    try {
      return JSON.parse(text) as WhisperCppOutput;
    } catch (error) {
      throw new MalformedTranscriptionResultError("whisper.cpp output file is not valid JSON", error);
    }
  }
}

export const whisperCppProvider: TranscriptionProvider = new WhisperCppTranscriptionProvider();

/** True when both WHISPER_BINARY_PATH and WHISPER_MODEL_PATH are set and point at real files. */
export async function isWhisperConfigured(): Promise<boolean> {
  try {
    await assertWhisperConfigured();
    return true;
  } catch {
    return false;
  }
}
