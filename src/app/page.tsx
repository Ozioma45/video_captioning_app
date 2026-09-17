import { Button } from "@/components/ui/button";

/**
 * First-open empty state (DESIGN_SYSTEM.md §12): one clear primary action,
 * minimal copy. Upload isn't implemented yet (Phase 2), so the action is
 * honestly disabled rather than faking a working flow (CLAUDE.md "do not
 * fake functionality").
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">No project yet</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Upload a video to generate captions, choose a style, and export a captioned MP4.
      </p>
      <Button disabled title="Upload arrives in Phase 2">
        Upload video (coming soon)
      </Button>
    </div>
  );
}
