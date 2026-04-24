import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { VideoEngine } from "@/features/video/engine";

type LocalePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LocalePage({ searchParams }: LocalePageProps) {
  const t = await getTranslations("common");
  const resolvedSearchParams = await searchParams;
  const entrypoint = pickValue(resolvedSearchParams.startapp) ?? "diagnostic";
  const tgId = pickValue(resolvedSearchParams.tgId) ?? "demo-user";
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: todos } = await supabase.from("todos").select();

  return (
    <main className="min-h-screen bg-[#0B1220] p-4 text-[#EAF2FF]">
      <h1 className="mb-2 text-xl font-semibold">{t("welcome")}</h1>
      <p className="mb-4 text-sm text-[#B7C6DC]">{t("start_diagnosis")}</p>
      {entrypoint === "player" ? (
        <VideoEngine tgId={tgId} apiBaseUrl={apiBaseUrl} serverDeadline={new Date(Date.now() + 86_400_000).toISOString()} />
      ) : null}
      {entrypoint === "sos" ? (
        <section className="mb-4 rounded-[20px] bg-[#8B1E2D] p-4 text-white shadow-[0_12px_28px_rgba(139,30,45,0.35)]">
          <h2 className="text-lg font-semibold">{t("panicButton")}</h2>
          <p className="text-sm text-white/90">{t("panicDone")}</p>
          <div className="mt-3">
            <VideoEngine tgId={tgId} apiBaseUrl={apiBaseUrl} serverDeadline={new Date(Date.now() + 30 * 60_000).toISOString()} />
          </div>
        </section>
      ) : null}
      <ul className="space-y-2">
        {todos?.map((todo: { id: string; name: string }) => (
          <li key={todo.id} className="rounded-md bg-white/10 px-3 py-2">
            {todo.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
