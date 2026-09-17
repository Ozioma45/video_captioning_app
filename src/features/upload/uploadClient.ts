import type { VideoMetadata } from "@/types";

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export interface UploadResult {
  videoId: string;
  metadata: VideoMetadata;
}

interface ErrorResponseBody {
  error?: { code?: string; message?: string };
}

/**
 * Uploads a raw file body (not multipart) via XMLHttpRequest, which is the
 * only common browser API that reports real upload byte-progress. The
 * server reads `request.body` as a stream directly — see
 * app/api/upload/route.ts — so nothing here or server-side ever buffers
 * the whole file (ARCHITECTURE.md §12).
 */
export function uploadVideoFile(file: File, onUploadProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (body && typeof body === "object" && "videoId" in body && "metadata" in body) {
          resolve(body as UploadResult);
        } else {
          reject(new UploadError("The server returned an unexpected response."));
        }
        return;
      }

      const errorBody = (body ?? {}) as ErrorResponseBody;
      reject(new UploadError(errorBody.error?.message ?? "Upload failed.", errorBody.error?.code));
    };

    xhr.onerror = () => reject(new UploadError("A network error interrupted the upload."));
    xhr.onabort = () => reject(new UploadError("The upload was cancelled."));

    xhr.send(file);
  });
}
