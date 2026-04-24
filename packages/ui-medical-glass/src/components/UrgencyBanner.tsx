import { useMemo } from "react";
import { GlassCard } from "./GlassCard.js";

type UrgencyBannerProps = {
  serverDeadline: string;
  title?: string;
};

export function UrgencyBanner({ serverDeadline, title = "Limited window" }: UrgencyBannerProps) {
  const deadlineText = useMemo(() => new Date(serverDeadline).toLocaleString(), [serverDeadline]);

  return (
    <GlassCard className="border-[#F6B94A]">
      <p className="text-xs uppercase tracking-wide text-[#F6B94A]">{title}</p>
      <p className="mt-1 text-sm text-[#EAF2FF]">Deadline: {deadlineText}</p>
    </GlassCard>
  );
}
