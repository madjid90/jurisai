import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, FileText, ShieldAlert, ShieldCheck, BookOpen, Search } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { listDocumentTemplates } from "@/server/templates.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({ meta: [{ title: "Modèles RH · JurisAI" }] }),
  component: TemplatesPage,
});

type Template = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  category: string;
  risk_level: string;
  status: string;
  version: number;
  legal_basis: Array<{ label: string; reference?: string; url?: string }> | unknown;
  variables: unknown;
  icon: string | null;
  is_public: boolean;
};

const RISK_STYLES: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  review: "En relecture",
  validated: "Validé",
  deprecated: "Obsolète",
};

function TemplatesPage() {
  const list = useServerFn(listDocumentTemplates);
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");

  useEffect(() => {
    void (async () => {
      try {
        const r = await list({ data: { status: "all" } });
        setItems(r as Template[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  const filtered = items.filter((t) => {
    if (activeCat !== "all" && t.category !== activeCat) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-[28px] font-bold tracking-tight">Modèles RH & juridiques</h1>
          <p className="text-[14px] text-muted-foreground">
            Bibliothèque de modèles de documents avec leurs bases légales et niveau de risque.
          </p>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[12.5px] text-amber-700 dark:text-amber-400">
            ⚠️ Les modèles fournis sont des structures techniques de démarrage. Faites-les valider
            par un juriste avant utilisation contractuelle.
          </div>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un modèle…"
              className="h-10 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-[13px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <select
            value={activeCat}
            onChange={(e) => setActiveCat(e.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-[13px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "Toutes catégories" : c}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">
            Aucun modèle ne correspond.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => {
              const basis = Array.isArray(t.legal_basis) ? t.legal_basis : [];
              return (
                <article
                  key={t.id}
                  className="glass-panel flex flex-col gap-3 rounded-2xl p-5 transition hover:shadow-[var(--shadow-elevated)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide",
                          RISK_STYLES[t.risk_level] ?? RISK_STYLES.medium,
                        )}
                      >
                        {t.risk_level === "low" ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                        {t.risk_level}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[14.5px] font-semibold leading-tight">{t.name}</h3>
                    <span className="mt-1 inline-block text-[11px] text-muted-foreground">
                      {t.category} · v{t.version}
                    </span>
                  </div>

                  {t.description && (
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t.description}</p>
                  )}

                  {basis.length > 0 && (
                    <div className="mt-auto space-y-1.5 border-t border-border pt-3">
                      <div className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        <BookOpen className="h-3 w-3" />
                        Bases légales
                      </div>
                      <ul className="space-y-0.5">
                        {basis.slice(0, 3).map((b: any, i: number) => (
                          <li key={i} className="text-[11.5px] text-foreground/80">
                            {b.url ? (
                              <a
                                href={b.url}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-accent hover:underline"
                              >
                                {b.label} {b.reference ? `(${b.reference})` : ""}
                              </a>
                            ) : (
                              <>
                                {b.label} {b.reference ? `(${b.reference})` : ""}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
