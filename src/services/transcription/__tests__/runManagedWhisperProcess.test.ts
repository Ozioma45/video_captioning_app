import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WhisperCancelledError, WhisperTimeoutError } from "../errors";
import { runManagedWhisperProcess } from "../runManagedWhisperProcess";

/**
 * These exercise real process spawn/timeout/cancel/progress behavior
 * without needing whisper.cpp or a model: `process.execPath` (node.exe,
 * always present) is spawned with a `-e` script we fully control, so the
 * suite never depends on downloading anything.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "whisper-process-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NODE = process.execPath;

/** A script that appends a timestamp to `heartbeatFile` every 20ms until killed — used to prove a process actually died rather than being orphaned. */
function heartbeatScript(heartbeatFile: string): string {
  const escaped = heartbeatFile.replace(/\\/g, "\\\\");
  return `const fs=require('fs');setInterval(()=>{try{fs.appendFileSync('${escaped}','x')}catch(e){}},20);`;
}

async function isStillRunning(heartbeatFile: string): Promise<boolean> {
  const before = safeSize(heartbeatFile);
  await new Promise((r) => setTimeout(r, 250));
  const after = safeSize(heartbeatFile);
  return after > before;
}
function safeSize(file: string): number {
  try {
    return readFileSync(file).length;
  } catch {
    return 0;
  }
}

describe("runManagedWhisperProcess", () => {
  it("resolves with elapsed time when the process completes before the timeout", async () => {
    const result = await runManagedWhisperProcess({
      binaryPath: NODE,
      args: ["-e", "process.exit(0)"],
      timeoutMs: 5000,
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.elapsedMs).toBeLessThan(5000);
  });

  it("does not fire the timeout after a process that already completed (timer is cleared)", async () => {
    // Generous timeoutMs relative to how long process.exit(0) actually takes
    // to settle (spawning a fresh node.exe has real, occasionally
    // load-dependent overhead) — the point of this test is "the timer got
    // cleared," not "settling is fast," so it must not itself be flaky.
    const timeoutMs = 3000;
    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const result = await runManagedWhisperProcess({ binaryPath: NODE, args: ["-e", "process.exit(0)"], timeoutMs });
      expect(result.elapsedMs).toBeLessThan(timeoutMs);
      // If the timer weren't cleared, it would still be pending here — wait
      // past its original deadline and confirm nothing rejects unhandled.
      await new Promise((r) => setTimeout(r, timeoutMs));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
    expect(rejections).toEqual([]);
  }, 10_000);

  it("genuinely times out: rejects with WhisperTimeoutError carrying elapsed/limit, and kills the process (no orphan)", async () => {
    const heartbeat = path.join(dir, "heartbeat.txt");
    writeFileSync(heartbeat, "");
    const timeoutMs = 300;
    const started = Date.now();

    await expect(
      runManagedWhisperProcess({ binaryPath: NODE, args: ["-e", heartbeatScript(heartbeat)], timeoutMs }),
    ).rejects.toBeInstanceOf(WhisperTimeoutError);

    const elapsedWallClock = Date.now() - started;
    expect(elapsedWallClock).toBeGreaterThanOrEqual(timeoutMs - 50);
    expect(elapsedWallClock).toBeLessThan(timeoutMs + 3000); // killed promptly, not left running

    expect(await isStillRunning(heartbeat)).toBe(false);
  }, 10_000);

  it("WhisperTimeoutError carries the actual elapsed and configured timeout", async () => {
    const timeoutMs = 200;
    try {
      await runManagedWhisperProcess({ binaryPath: NODE, args: ["-e", "setInterval(()=>{},1000)"], timeoutMs });
      expect.unreachable("should have timed out");
    } catch (error) {
      expect(error).toBeInstanceOf(WhisperTimeoutError);
      const timeoutError = error as WhisperTimeoutError;
      expect(timeoutError.timeoutMs).toBe(timeoutMs);
      expect(timeoutError.elapsedMs).toBeGreaterThanOrEqual(timeoutMs - 50);
    }
  }, 10_000);

  it("rejects with a distinguishable error for a non-zero exit (not misclassified as a timeout)", async () => {
    try {
      await runManagedWhisperProcess({
        binaryPath: NODE,
        args: ["-e", "process.stderr.write('boom\\n');process.exit(7)"],
        timeoutMs: 5000,
      });
      expect.unreachable("should have rejected");
    } catch (error) {
      expect(error).not.toBeInstanceOf(WhisperTimeoutError);
      expect(error).not.toBeInstanceOf(WhisperCancelledError);
      expect((error as Error).message).toContain("code 7");
      expect((error as { stderr?: string }).stderr).toContain("boom");
    }
  });

  it("rejects with a real spawn error for a binary that doesn't exist (not a timeout, not a non-zero exit)", async () => {
    try {
      await runManagedWhisperProcess({
        binaryPath: path.join(dir, "does-not-exist.exe"),
        args: [],
        timeoutMs: 5000,
      });
      expect.unreachable("should have rejected");
    } catch (error) {
      expect(error).not.toBeInstanceOf(WhisperTimeoutError);
      expect(typeof (error as NodeJS.ErrnoException).code).toBe("string"); // ENOENT — a spawn failure, not a process outcome
    }
  });

  it("cancellation during transcription: rejects with WhisperCancelledError (not timeout/generic), kills the process", async () => {
    const heartbeat = path.join(dir, "heartbeat2.txt");
    writeFileSync(heartbeat, "");

    const promise = runManagedWhisperProcess({
      binaryPath: NODE,
      args: ["-e", heartbeatScript(heartbeat)],
      timeoutMs: 30_000,
      onProcessStart: (handle) => {
        setTimeout(() => handle.cancel(), 150);
      },
    });

    await expect(promise).rejects.toBeInstanceOf(WhisperCancelledError);
    expect(await isStillRunning(heartbeat)).toBe(false);
  }, 10_000);

  it("cancelling after the process already finished is a safe no-op", async () => {
    let handle: { cancel: () => void } | null = null;
    const result = await runManagedWhisperProcess({
      binaryPath: NODE,
      args: ["-e", "process.exit(0)"],
      timeoutMs: 5000,
      onProcessStart: (h) => {
        handle = h;
      },
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(() => handle?.cancel()).not.toThrow();
  });

  it("reports real progress parsed from stderr, clamped to 100", async () => {
    const seen: number[] = [];
    const script = [
      "process.stderr.write('whisper_print_progress_callback: progress =  20%\\n');",
      "setTimeout(()=>{process.stderr.write('whisper_print_progress_callback: progress =  60%\\n')},10);",
      "setTimeout(()=>{process.stderr.write('whisper_print_progress_callback: progress = 107%\\n');process.exit(0)},20);",
    ].join("");
    await runManagedWhisperProcess({
      binaryPath: NODE,
      args: ["-e", script],
      timeoutMs: 5000,
      onProgress: (percent) => seen.push(percent),
    });
    expect(seen).toEqual([20, 60, 100]);
  });

  it("never calls onProgress when the process reports none", async () => {
    const seen: number[] = [];
    await runManagedWhisperProcess({
      binaryPath: NODE,
      args: ["-e", "process.exit(0)"],
      timeoutMs: 5000,
      onProgress: (percent) => seen.push(percent),
    });
    expect(seen).toEqual([]);
  });

  it("records the real process exit even after a timeout already decided the outcome (forensic logging)", async () => {
    const ends: Array<{ code: number | null; signal: string | null; alreadySettled: boolean }> = [];
    await expect(
      runManagedWhisperProcess({
        binaryPath: NODE,
        args: ["-e", "setInterval(()=>{},1000)"],
        timeoutMs: 150,
        onProcessEnd: (info) => ends.push(info),
      }),
    ).rejects.toBeInstanceOf(WhisperTimeoutError);
    await new Promise((r) => setTimeout(r, 300)); // give the killed process's own 'close' event time to arrive
    expect(ends.length).toBeGreaterThanOrEqual(1);
    expect(ends[0].alreadySettled).toBe(true);
  }, 5000);

  it("many timeouts in a row leave no orphaned processes and no growing delay (no leak)", async () => {
    const heartbeat = path.join(dir, "heartbeat3.txt");
    for (let i = 0; i < 5; i++) {
      writeFileSync(heartbeat, "");
      await expect(
        runManagedWhisperProcess({ binaryPath: NODE, args: ["-e", heartbeatScript(heartbeat)], timeoutMs: 120 }),
      ).rejects.toBeInstanceOf(WhisperTimeoutError);
    }
    expect(await isStillRunning(heartbeat)).toBe(false);
  }, 15_000);
});
