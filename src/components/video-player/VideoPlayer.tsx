"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Maximize2, Minimize2 } from "lucide-react";

import { CaptionDebugReadout } from "@/components/caption-overlay/CaptionDebugReadout";
import { CaptionOverlay } from "@/components/caption-overlay/CaptionOverlay";
import { cn } from "@/lib/utils";
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
 *
 * Phase 6: the caption overlay shares a positioning box with the video, so
 * it is always exactly video-sized. The store's `currentTime` is mirrored
 * from the element by one place only (the sync effect below): the element
 * events for seeks/pauses, plus a single requestAnimationFrame loop that
 * runs *only while playing* — `timeupdate` alone fires ~4x/second, too
 * coarse for word-level highlighting.
 */
export function VideoPlayer({ videoId }: { videoId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // Playback clock mirror: element → store, never the other way around.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frame = 0;
    const sync = () => setCurrentTime(video.currentTime);
    const tick = () => {
      sync();
      frame = requestAnimationFrame(tick);
    };
    const startLoop = () => {
      if (!frame) tick();
    };
    const stopLoop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      sync();
    };

    video.addEventListener("play", startLoop);
    video.addEventListener("playing", startLoop);
    video.addEventListener("pause", stopLoop);
    video.addEventListener("ended", stopLoop);
    for (const name of ["seeking", "seeked", "timeupdate"] as const) video.addEventListener(name, sync);
    if (!video.paused) startLoop();

    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", startLoop);
      video.removeEventListener("playing", startLoop);
      video.removeEventListener("pause", stopLoop);
      video.removeEventListener("ended", stopLoop);
      for (const name of ["seeking", "seeked", "timeupdate"] as const) video.removeEventListener(name, sync);
    };
  }, [setCurrentTime]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  }

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
      <div
        ref={stageRef}
        className={cn(isFullscreen && "flex h-full w-full items-center justify-center bg-black")}
      >
        <div
          className="relative"
          style={
            isFullscreen && videoAspect
              ? { width: `min(100vw, calc(100vh * ${videoAspect}))`, aspectRatio: String(videoAspect) }
              : { width: "100%" }
          }
        >
          <video
            ref={videoRef}
            controls
            controlsList="nofullscreen"
            preload="metadata"
            className={cn("block w-full bg-black", isFullscreen ? "h-full" : "rounded-lg")}
            src={`/api/videos/${videoId}/stream`}
            onLoadedMetadata={(event) => {
              const el = event.currentTarget;
              setDuration(el.duration);
              if (el.videoWidth > 0 && el.videoHeight > 0) setVideoAspect(el.videoWidth / el.videoHeight);
            }}
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
          <CaptionOverlay />
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
      {process.env.NODE_ENV === "development" && <CaptionDebugReadout />}
    </div>
  );
}
