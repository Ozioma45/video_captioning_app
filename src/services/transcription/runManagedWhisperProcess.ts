import { spawn } from "node:child_process";

import type { CancellableProcessHandle } from "@/types";
import { WhisperCancelledError, WhisperTimeoutError } from "./errors";
import { extractLatestWhisperProgressPercent, stripWhisperProgressLines } from "./parseWhisperProgress";

/**
 * Process-lifecycle wrapper around one whisper.cpp invocation — the part
 * of `WhisperCppTranscriptionProvider` that spawns, times out, cancels,
 * and reports progress, split out so it's unit-testable against any
 * spawnable binary (tests use `process.execPath` with a controlled `-e`
 * script; nothing here depends on whisper.cpp or a model actually being
 * installed). Argument-building (`buildWhisperArgs`) and output parsing
 * stay in the provider — this module only knows "run this binary with
 * these args, kill it if it runs too long, report the process's own
 * progress lines."
 *
 * Distinguishes three outcomes that `WhisperCppTranscriptionProvider`
 * previously conflated into one generic Error (see ARCHITECTURE.md's
 * Whisper reliability notes):
 * - `WhisperTimeoutError` — killed by our own timer (SIGKILL).
 * - `WhisperCancelledError` — killed by the caller's cancel handle (SIGTERM).
 * - anything else — a real spawn error or a non-zero exit, left for the
 *   caller to classify with `classifyWhisperExecError` (unchanged).
 */

export interface RunManagedWhisperProcessOptions {
  binaryPath: string;
  args: string[];
  /** Milliseconds before the process is killed and the promise rejects with `WhisperTimeoutError`. */
  timeoutMs: number;
  /** Parsed from whisper.cpp's `-pp` stderr output (0-100, clamped); omitted when `-pp` wasn't passed. */
  onProgress?: (percent: number) => void;
  onProcessStart?: (handle: CancellableProcessHandle) => void;
  /**
   * Called once the process ends, however it ends — including after the
   * promise has already settled from a timeout (so a slow-to-die SIGKILL
   * target's eventual real exit is still recorded). Diagnostics only;
   * never changes the settled outcome.
   */
  onProcessEnd?: (info: { code: number | null; signal: NodeJS.Signals | null; alreadySettled: boolean }) => void;
}

export interface ManagedWhisperProcessResult {
  elapsedMs: number;
}

/** Cap on the retained stderr tail kept for failure diagnostics (progress lines excluded, see parseWhisperProgress.ts). */
const STDERR_DIAGNOSTIC_TAIL_BYTES = 4000;

export function runManagedWhisperProcess(options: RunManagedWhisperProcessOptions): Promise<ManagedWhisperProcessResult> {
  const { binaryPath, args, timeoutMs, onProgress, onProcessStart, onProcessEnd } = options;
  const startedAt = Date.now();

  return new Promise<ManagedWhisperProcessResult>((resolve, reject) => {
    const child = spawn(binaryPath, args);

    let progressScanBuffer = ""; // full recent stderr, used only to find the latest "progress = NN%"
    let diagnosticTail = ""; // progress lines stripped out, capped — what a failure's error.stderr shows
    let settled = false;
    let cancelRequested = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new WhisperTimeoutError(Date.now() - startedAt, timeoutMs));
    }, timeoutMs);

    function settle(error: Error | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ elapsedMs: Date.now() - startedAt });
    }

    onProcessStart?.({
      cancel: () => {
        if (settled) return;
        cancelRequested = true;
        child.kill("SIGTERM");
      },
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");

      progressScanBuffer = (progressScanBuffer + text).slice(-2000);
      const percent = extractLatestWhisperProgressPercent(progressScanBuffer);
      if (percent !== null) onProgress?.(percent);

      diagnosticTail = (diagnosticTail + stripWhisperProgressLines(text)).slice(-STDERR_DIAGNOSTIC_TAIL_BYTES);
    });

    child.on("error", (error) => settle(error));

    child.on("close", (code, signal) => {
      onProcessEnd?.({ code, signal, alreadySettled: settled });
      if (settled) return; // outcome (timeout) already decided; this is forensic-only

      if (cancelRequested) {
        settle(new WhisperCancelledError());
        return;
      }
      if (code === 0) {
        settle(null);
        return;
      }
      settle(
        Object.assign(new Error(`whisper.cpp exited with code ${code ?? "null"} (signal ${signal ?? "none"})`), {
          code: code ?? undefined,
          stderr: diagnosticTail,
        }),
      );
    });
  });
}
