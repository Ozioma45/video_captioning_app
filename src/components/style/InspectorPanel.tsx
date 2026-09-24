"use client";

import { useState } from "react";

import { VideoMetadataPanel } from "@/components/video-player/VideoMetadataPanel";
import { cn } from "@/lib/utils";
import type { Video } from "@/types";
import { CaptionStyleControls } from "./CaptionStyleControls";
import { CaptionStyleSelector } from "./CaptionStyleSelector";

type Tab = "info" | "style";

const TABS: { id: Tab; label: string }[] = [
  { id: "info", label: "Info" },
  { id: "style", label: "Style" },
];

/**
 * Right-hand inspector: video information and caption styling as two tabs
 * (DESIGN_SYSTEM.md §7 — one primary side-panel context at a time). Styling
 * lives here, not in the bottom workspace, so the caption editor keeps its
 * full width (Phase 5 brief §23). Style controls scroll inside the panel
 * so a long control list never stretches the page.
 */
export function InspectorPanel({ video }: { video: Video }) {
  const [tab, setTab] = useState<Tab>("info");

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Inspector" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`inspector-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            aria-controls={`inspector-panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <div role="tabpanel" id="inspector-panel-info" aria-labelledby="inspector-tab-info">
          <VideoMetadataPanel video={video} />
        </div>
      )}

      {tab === "style" && (
        <div
          role="tabpanel"
          id="inspector-panel-style"
          aria-labelledby="inspector-tab-style"
          className="flex max-h-[36rem] flex-col gap-5 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-card p-4"
        >
          <h2 className="text-sm font-semibold">Caption style</h2>
          <CaptionStyleSelector />
          <CaptionStyleControls />
        </div>
      )}
    </div>
  );
}
