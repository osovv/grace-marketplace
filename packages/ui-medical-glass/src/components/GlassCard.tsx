import type { PropsWithChildren } from "react";

type GlassCardProps = PropsWithChildren<{ className?: string }>;

export function GlassCard({ className = "", children }: GlassCardProps) {
  return (
    <section
      className={`medical-glass rounded-[20px] p-4 text-[#EAF2FF] ${className}`}
      aria-live="polite"
    >
      {children}
    </section>
  );
}
