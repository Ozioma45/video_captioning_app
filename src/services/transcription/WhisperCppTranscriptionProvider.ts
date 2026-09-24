import { spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";

import { WHISPER_BINARY_PATH, WHISPER_LANGUAGE, WHISPER_MODEL_PATH, WHISPER_TIMEOUT_MS } from "@/config/whisper";
import type { TranscriptionInput, TranscriptionResult } from "@/types";
import type { TranscriptionProvider } from "./TranscriptionService";
import { parseWhisperCppOutput, type WhisperCppOutput } from "./parseWhisperCppOutput";
import {
  classifyWhisperExecError,
  MalformedTranscriptionResultError,
  WhisperBinaryMissingError,
  WhisperModelMissingError,
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

/**
 * `TranscriptionProvider` backed by a local whisper.cpp binary (confirmed
 * Phase 0 decision; ARCHITECTURE.md §6). All whisper.cpp-specific
 * argument/output-format knowledge lives in this file and
 * `parseWhisperCppOutput` — nothing outside `services/transcription/`
 * ever sees whisper's raw JSON shape (CLAUDE.md "keep processing logic
 * separate from UI" / provider-abstraction requirement).
 *
 * Invoked via `spawn` with an argument array, never a shell string
 * (CLAUDE.md, Phase 2 incident). Binary/model paths come from
 * `config/whisper.ts` (environment-driven, never hard-coded) and are
 * checked with a real filesystem access *before* spawning anything, so a
 * missing setup fails as a clear configuration error rather than an
 * opaque process failure (Phase 3 brief §2).
 */
export class WhisperCppTranscriptionProvider implements TranscriptionProvider {
  readonly id = "local-whisper-cpp" as const;

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    await assertWhisperConfigured();

    const outputBasename = input.audioFilePath.replace(/\.[^./\\]+$/, "");
    const outputJsonPath = `${outputBasename}.json`;

    try {
      await this.runWhisper(input, outputBasename);
      const raw = await this.readOutput(outputJsonPath);
      return parseWhisperCppOutput(raw);
    } finally {
      await rm(outputJsonPath, { force: true }).catch(() => {});
    }
  }

  private runWhisper(input: TranscriptionInput, outputBasename: string): Promise<void> {
    // Do NOT pass `-nt` (--no-timestamps): it disables whisper's timestamp
    // tokens, which collapses the output into one segment per 30 s window
    // and makes word times drift by many seconds (found 2026-09-24 by
    // comparing a real 40 s transcription with and without it). `-ojf`
    // only writes JSON, so nothing needs suppressing.
    const args = [
      "-m",
      WHISPER_MODEL_PATH as string,
      "-f",
      input.audioFilePath,
      "-l",
      input.language || WHISPER_LANGUAGE,
      "-ojf",
      "-of",
      outputBasename,
    ];

    return new Promise<void>((resolve, reject) => {
      const child = spawn(WHISPER_BINARY_PATH as string, args);
      let stderrBuffer = "";
      let settled = false;

      input.onProcessStart?.({ cancel: () => child.kill("SIGTERM") });

      const timer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
        settle(new Error("whisper.cpp transcription timed out"));
      }, WHISPER_TIMEOUT_MS);

      function settle(error: Error | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString("utf-8");
        if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-4000);
      });

      child.on("error", (error) => settle(error));

      child.on("close", (code) => {
        if (code === 0) {
          settle(null);
          return;
        }
        settle(Object.assign(new Error(`whisper.cpp exited with code ${code}`), { code: code ?? undefined, stderr: stderrBuffer }));
      });
    }).catch((error: unknown) => {
      const classified = classifyWhisperExecError(error);
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      console.error(
        `[whisper.cpp] ${classified.name} while transcribing ${input.audioFilePath}:`,
        `code=${nodeError.code ?? "unknown"}`,
        nodeError.stderr ? `stderr=${nodeError.stderr.slice(0, 500)}` : `message=${nodeError.message}`,
      );
      throw classified;
    });
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
