import { useTranslations } from "next-intl";

export function useI18n(namespace: string) {
  const t = useTranslations(namespace);
  return { t };
}
