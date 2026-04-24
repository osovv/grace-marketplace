"use client";

import { PanicButton } from "./panic-button";
import { useI18n } from "../../lib/i18n";

type VideoEngineProps = {
  tgId: string;
  apiBaseUrl: string;
  serverDeadline: string;
};

export function VideoEngine({ tgId, apiBaseUrl, serverDeadline }: VideoEngineProps) {
  const { t } = useI18n("common");

  return (
    <div className="space-y-4">
      <div className="medical-glass rounded-[20px] p-4 text-[#EAF2FF]">
        <h2 className="text-lg font-semibold">{t("exercisePlayer")}</h2>
        <p className="text-sm text-[#B7C6DC]">
          {t("deadlineLabel")}: {new Date(serverDeadline).toLocaleString()}
        </p>
      </div>
      <PanicButton tgId={tgId} apiBaseUrl={apiBaseUrl} />
    </div>
  );
}
