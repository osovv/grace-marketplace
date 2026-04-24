import type { LocaleCode } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditLog } from "../../lib/audit.js";

const SUPPORTED = new Set<LocaleCode>(["ru", "en", "ky"]);
const DEFAULT_LOCALE: LocaleCode = "ru";

function parseAcceptLanguage(header?: string): LocaleCode | null {
  if (!header) return null;
  const values = header
    .split(",")
    .map((v) => v.trim().split(";")[0]?.toLowerCase())
    .filter(Boolean);
  for (const value of values) {
    const short = value.slice(0, 2) as LocaleCode;
    if (SUPPORTED.has(short)) return short;
  }
  return null;
}

export async function resolveLocale(params: {
  tgId?: string;
  acceptLanguage?: string;
}): Promise<LocaleCode> {
  const { tgId, acceptLanguage } = params;

  if (tgId) {
    const user = await prisma.user.findUnique({
      where: { tgId },
      select: { preferredLocale: true },
    });
    if (user?.preferredLocale && SUPPORTED.has(user.preferredLocale)) {
      auditLog("M-025", "resolveLocale", "USER_PREF", "Locale resolved by user preference", {
        tgId,
        locale: user.preferredLocale,
      });
      return user.preferredLocale;
    }
  }

  const fromHeader = parseAcceptLanguage(acceptLanguage);
  if (fromHeader) {
    auditLog("M-025", "resolveLocale", "HEADER", "Locale resolved by Accept-Language", {
      locale: fromHeader,
    });
    return fromHeader;
  }

  auditLog("M-025", "resolveLocale", "DEFAULT", "Locale defaulted", {
    locale: DEFAULT_LOCALE,
  });
  return DEFAULT_LOCALE;
}

export async function persistBotDetectedLocale(tgId: string, locale?: string): Promise<void> {
  const normalized = (locale?.slice(0, 2).toLowerCase() ?? DEFAULT_LOCALE) as LocaleCode;
  const preferredLocale = SUPPORTED.has(normalized) ? normalized : DEFAULT_LOCALE;

  await prisma.user.upsert({
    where: { tgId },
    create: { tgId, preferredLocale },
    update: { preferredLocale },
  });

  auditLog("M-025", "persistBotDetectedLocale", "UPSERT", "Locale persisted from bot start", {
    tgId,
    preferredLocale,
  });
}
