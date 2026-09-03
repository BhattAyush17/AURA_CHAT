/**
 * DiagnosticSection — shared collapsible card used by all panel sections.
 * Mirrors the style of the legacy section in RuntimeDiagnosticsDrawer so
 * the new observability sections feel native to the existing drawer.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface DiagnosticSectionProps {
  title: string;
  icon: any;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function DiagnosticSection({
  title,
  icon: Icon,
  badge,
  defaultOpen = true,
  children,
}: DiagnosticSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-border/40 bg-foreground/[0.02] overflow-hidden mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-foreground/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="h-3.5 w-3.5 text-foreground/70" strokeWidth={1.75} />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {title}
          </span>
          {badge && (
            <span className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-foreground/10 text-muted-foreground font-mono">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && <div className="p-4 pt-1 border-t border-border/20">{children}</div>}
    </div>
  );
}
