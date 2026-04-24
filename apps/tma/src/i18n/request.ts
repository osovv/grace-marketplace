import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;
  const selectedLocale = locale && routing.locales.includes(locale as "ru" | "en" | "ky")
    ? locale
    : routing.defaultLocale;

  return {
    locale: selectedLocale,
    messages: (await import(`../../messages/${selectedLocale}.json`)).default,
  };
});
