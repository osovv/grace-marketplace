import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { updateSession } from "./utils/supabase/middleware";

const i18nMiddleware = createMiddleware(routing);

export default async function middleware(request: Parameters<typeof i18nMiddleware>[0]) {
  const response = i18nMiddleware(request);
  return updateSession(request, response);
}

export const config = {
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
