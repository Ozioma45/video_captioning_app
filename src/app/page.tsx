"use client";

import { VideoMetadataPanel } from "@/components/video-player/VideoMetadataPanel";
import { VideoPlayer } from "@/components/video-player/VideoPlayer";
import { UploadDropzone } from "@/features/upload/UploadDropzone";
import { useProjectStore } from "@/stores";

export default function Home() {
  const video = useProjectStore((state) => state.video);

  if (!video) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No project yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Upload a video to generate captions, choose a style, and export a captioned MP4.
        </p>
        <UploadDropzone />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:flex-row">
      <div className="flex-1">
        <VideoPlayer key={video.id} videoId={video.id} />
      </div>
      <div className="w-full shrink-0 md:w-72">
        <VideoMetadataPanel video={video} />
      </div>
    </div>
  );
}
