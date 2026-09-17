/**
 * TranscriptionProvider abstraction (PROJECT.md §9, ARCHITECTURE.md §6).
 *
 * Interface only — no implementation in Phase 1. `LocalWhisperProvider`
 * (whisper.cpp, confirmed Phase 0 decision) is built in Phase 3. Do not add
 * a class here that pretends to transcribe anything (CLAUDE.md "do not
 * fake functionality").
 */

import type { TranscriptionInput, TranscriptionResult, TranscriptionProviderId } from "@/types";

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
