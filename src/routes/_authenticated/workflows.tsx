import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, Clock, FileText, BookOpen, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import {
  listWorkflowDefinitions,
  listWorkflowInstances,
  startWorkflow,
  cancelWorkflow,
  type WorkflowStep,
} from "@/server/workflows.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/workflows")({
  head: () => ({ meta: [{ title: "Procédures · JurisAI" }] }),
  component: WorkflowsPage,
});

type Definition = {
  id: string; slug: string; title: string; description: string | null;
  category: string; status: string; steps: WorkflowStep[];
  estimated_duration_days: number | null;
};

type Instance = {
  id: string; title: string; status: string;
  current_step_index: number; definition_id: string;
  created_at: string; completed_at: string | null;
};

function WorkflowsPage() {
  const listDefs = useServerFn(listWorkflowDefinitions);
  const listInsts = useServerFn(listWorkflowInstances);
  const start = useServerFn(startWorkflow);
  const cancel = useServerFn(cancelWorkflow);

  const [defs, setDefs] = useState<Definition[]>([]);
  const [insts, setInsts] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [tab, setTab] = useState<"actives" | "catalogue" | "completed">("actives");
  const [domain, setDomain] = useState<string>("all");
  const [query, setQuery] = useState("");

  const reload = async () => {
    try {
      const [d, i] = await Promise.all([listDefs(), listInsts({ data: { status: "all" } })]);
      setDefs(d as Definition[]);
      setInsts(i as Instance[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async (def: Definition) => {
    setStarting(def.id);
    try {
      const { id } = await start({
        data: { definitionId: def.id, title: def.title },
      });
      toast.success("Procédure démarrée");
      await reload();
      setTab("actives");
      return id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec du démarrage");
    } finally {
      setStarting(null);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancel({ data: { instanceId: id } });
      toast.success("Procédure annulée");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const activeInsts = insts.filter((i) => i.status === "active");
  const completedInsts = insts.filter((i) => i.status !== "active");

  const DOMAIN_LABELS: Record<string, string> = {
    social: "Social / RH",
    discipline: "Discipline",
    commercial: "Commercial",
    societes: "Sociétés",
    fiscal: "Fiscal",
    administratif: "Administratif",
    contentieux: "Contentieux",
    rgpd: "RGPD",
  };
  const domains = Array.from(new Set(defs.map((d) => d.category))).sort();
  const filteredDefs = defs.filter((d) => {
    if (domain !== "all" && d.category !== domain) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !(d.description ?? "").toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-[28px] font-bold tracking-tight">Procédures guidées</h1>
          <p className="text-[14px] text-muted-foreground">
            Lancez et suivez pas-à-pas vos procédures RH/juridiques avec les bases légales associées.
          </p>
        </header>

        <div className="flex gap-1 rounded-xl bg-secondary/40 p-1">
          {[
            { k: "actives", label: `En cours (${activeInsts.length})` },
            { k: "catalogue", label: `Catalogue (${defs.length})` },
            { k: "completed", label: `Historique (${completedInsts.length})` },
          ].map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k as typeof tab)}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-[13px] font-medium transition",
                tab === t.k
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : tab === "catalogue" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une procédure…"
                className="h-9 flex-1 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDomain("all")}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11.5px] font-medium transition",
                    domain === "all" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  Tous
                </button>
                {domains.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDomain(c)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11.5px] font-medium transition capitalize",
                      domain === c ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {DOMAIN_LABELS[c] ?? c}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredDefs.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                  Aucune procédure ne correspond à vos filtres.
                </div>
              )}
              {filteredDefs.map((d) => (
              <article key={d.id} className="glass-panel flex flex-col gap-3 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-semibold">{d.title}</h3>
                    <span className="mt-1 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent">
                      {d.category}
                    </span>
                  </div>
                  {d.estimated_duration_days != null && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {d.estimated_duration_days}j
                    </span>
                  )}
                </div>
                {d.description && (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">{d.description}</p>
                )}
                <div className="text-[11.5px] text-muted-foreground">
                  {d.steps?.length ?? 0} étape{(d.steps?.length ?? 0) > 1 ? "s" : ""}
                </div>
                <button
                  type="button"
                  onClick={() => handleStart(d)}
                  disabled={starting === d.id}
                  className="mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[12.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
                >
                  {starting === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Démarrer
                </button>
              </article>
            ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(tab === "actives" ? activeInsts : completedInsts).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                {tab === "actives" ? "Aucune procédure en cours." : "Aucune procédure terminée."}
              </div>
            ) : (
              (tab === "actives" ? activeInsts : completedInsts).map((i) => {
                const def = defs.find((d) => d.id === i.definition_id);
                const total = def?.steps?.length ?? 0;
                const pct = total ? Math.round((i.current_step_index / total) * 100) : 0;
                return (
                  <Link
                    key={i.id}
                    to="/workflows/$id"
                    params={{ id: i.id }}
                    className="glass-panel flex items-center gap-4 rounded-2xl p-4 transition hover:shadow-[var(--shadow-elevated)]"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      {i.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : i.status === "cancelled" ? (
                        <X className="h-5 w-5" />
                      ) : (
                        <BookOpen className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-[14px] font-semibold">{i.title}</h4>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                          {i.status}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {i.current_step_index}/{total}
                        </span>
                      </div>
                    </div>
                    {i.status === "active" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleCancel(i.id);
                        }}
                        className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Annuler"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
