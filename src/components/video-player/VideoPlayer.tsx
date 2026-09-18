"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { usePlaybackStore } from "@/stores";

/**
 * Native HTML5 `<video>` wrapper (DESIGN_SYSTEM.md §8: "standard player
 * affordances... not the place for novel interaction patterns"). Uses the
 * browser's own controls for play/pause/seek/volume rather than a custom
 * control bar — that's later polish (Phase 9), not Phase 2.
 *
 * Streams from the server route rather than a client object URL, so a
 * 2-hour file is never pulled fully into the browser at once; the video
 * element's own Range requests to that route handle seeking.
 */
export function VideoPlayer({ videoId }: { videoId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const setCurrentTime = usePlaybackStore((state) => state.setCurrentTime);
  const setDuration = usePlaybackStore((state) => state.setDuration);
  const setIsPlaying = usePlaybackStore((state) => state.setIsPlaying);
  const setVolume = usePlaybackStore((state) => state.setVolume);
  const setIsMuted = usePlaybackStore((state) => state.setIsMuted);
  const seekRequestSeconds = usePlaybackStore((state) => state.seekRequestSeconds);
  const clearSeekRequest = usePlaybackStore((state) => state.clearSeekRequest);
  const reset = usePlaybackStore((state) => state.reset);

  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    return () => reset();
  }, [reset]);

  // Phase 4: clicking/navigating a caption requests a seek via the store;
  // this is the one place that command is actually applied to the real
  // element (see usePlaybackStore's doc comment).
  useEffect(() => {
    if (seekRequestSeconds === null) return;
    if (videoRef.current) {
      videoRef.current.currentTime = seekRequestSeconds;
    }
    clearSeekRequest();
  }, [seekRequestSeconds, clearSeekRequest]);

  return (
    <div className="flex flex-col gap-2">
      {playbackError && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{playbackError}</span>
        </div>
      )}
      <video
        ref={videoRef}
        controls
        preload="metadata"
        className="w-full rounded-lg bg-black"
        src={`/api/videos/${videoId}/stream`}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setIsMuted(event.currentTarget.muted);
        }}
        onError={() => setPlaybackError("This video couldn't be played in your browser.")}
      >
        Your browser does not support embedded video playback.
      </video>
    </div>
  );
}
