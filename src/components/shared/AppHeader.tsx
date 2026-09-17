import { APP_NAME } from "@/config/app";

/**
 * Minimal top bar (DESIGN_SYSTEM.md §7: "minimal top bar"). Deliberately
 * bare — project name / real navigation / export action arrive alongside
 * the features that make them meaningful (Phase 2+).
 */
export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
      <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
    </header>
  );
}
