"use client";

import { useState } from "react";
import { useI18n } from "../../lib/i18n";

type PanicButtonProps = {
  tgId: string;
  exerciseId?: string;
  sessionRef?: string;
  apiBaseUrl: string;
};

export function PanicButton({ tgId, exerciseId, sessionRef, apiBaseUrl }: PanicButtonProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { t } = useI18n("common");

  async function triggerEscalation() {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/safety/panic`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tgId, exerciseId, sessionRef }),
      });
      if (!response.ok) {
        throw new Error("Escalation request failed");
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={triggerEscalation}
      disabled={loading || done}
      className="w-full rounded-[14px] bg-[#8B1E2D] px-4 py-3 text-white shadow-[0_8px_24px_rgba(139,30,45,0.35)] disabled:opacity-60"
      aria-label="Emergency panic escalation"
    >
      {done ? t("panicDone") : loading ? t("panicSending") : t("panicButton")}
    </button>
  );
}
