"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

const FIELD_LABEL = "text-xs text-muted-foreground";
const CONTROL =
  "rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={String(value)}
        onChange={(event) => {
          const chosen = options.find((option) => String(option.value) === event.target.value);
          if (chosen) onChange(chosen.value);
        }}
        className={cn(CONTROL, "min-w-0 max-w-[10rem]")}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Range input. Dispatches on every change on purpose: a style update is
 * one tiny state write with a couple of subscribers (the controls and the
 * preview) — unlike a caption list, there is nothing expensive to sweep,
 * and live feedback while dragging is the point (DESIGN_SYSTEM.md §9).
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{value.toUpperCase()}</span>
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}

export function ControlSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
