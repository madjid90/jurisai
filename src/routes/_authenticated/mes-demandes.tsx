import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listMyRuns, type AgentRunStatus } from "@/server/agent-runs.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Inbox, Search, Clock, CheckCircle2, AlertCircle, Loader2, Archive, FileQuestion, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mes-demandes")({
  head: () => ({
    meta: [
      { title: "Mes demandes — JurisAI" },
      { name: "description", content: "Suivi de toutes vos demandes en cours auprès de l'assistant juridique." },
    ],
  }),
  component: MesDemandesPage,
});

type Filter = "all" | "active" | "waiting" | "done" | "archived";

const STATUS_META: Record<string, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: "En attente", tone: "bg-muted text-muted-foreground", icon: Clock },
  running: { label: "En cours", tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400", icon: Loader2 },
  waiting_info: { label: "Info requise", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400", icon: FileQuestion },
  waiting_validation: { label: "À valider", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: AlertCircle },
  ready: { label: "Prêt", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: PlayCircle },
  executed: { label: "Exécuté", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  archived: { label: "Archivé", tone: "bg-muted text-muted-foreground", icon: Archive },
  failed: { label: "Échec", tone: "bg-destructive/10 text-destructive", icon: AlertCircle },
};

const ACTIVE_STATUSES: AgentRunStatus[] = ["pending", "running"];
const WAITING_STATUSES: AgentRunStatus[] = ["waiting_info", "waiting_validation", "ready"];
const DONE_STATUSES: AgentRunStatus[] = ["executed"];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

function MesDemandesPage() {
  const navigate = useNavigate();
  const list = useServerFn(listMyRuns);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const { data: rows, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["my-agent-runs"],
    queryFn: () => list({ data: { scope: "mine", limit: 100 } }),
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    let r = rows;
    if (filter === "active") r = r.filter((x) => ACTIVE_STATUSES.includes(x.status as AgentRunStatus));
    else if (filter === "waiting") r = r.filter((x) => WAITING_STATUSES.includes(x.status as AgentRunStatus));
    else if (filter === "done") r = r.filter((x) => DONE_STATUSES.includes(x.status as AgentRunStatus));
    else if (filter === "archived") r = r.filter((x) => x.status === "archived");
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((x) => (x.title ?? "").toLowerCase().includes(s) || (x.message ?? "").toLowerCase().includes(s));
    }
    return r;
  }, [rows, filter, q]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, waiting: 0, done: 0, archived: 0 };
    if (!rows) return c;
    c.all = rows.length;
    for (const r of rows) {
      const s = r.status as AgentRunStatus;
      if (ACTIVE_STATUSES.includes(s)) c.active++;
      else if (WAITING_STATUSES.includes(s)) c.waiting++;
      else if (DONE_STATUSES.includes(s)) c.done++;
      else if (s === "archived") c.archived++;
    }
    return c;
  }, [rows]);

  const FILTERS: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: "Toutes", count: counts.all },
    { id: "active", label: "En cours", count: counts.active },
    { id: "waiting", label: "Action requise", count: counts.waiting },
    { id: "done", label: "Terminées", count: counts.done },
    { id: "archived", label: "Archivées", count: counts.archived },
  ];

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Mes demandes</h1>
            <p className="text-sm text-muted-foreground">Boîte de réception de vos sollicitations à l'assistant.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Actualiser"}
          </Button>
          <Button size="sm" onClick={() => navigate({ to: "/agent" })}>
            Nouvelle demande
          </Button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
              filter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
            <span className={cn("rounded-full px-1.5 text-xs", filter === f.id ? "bg-primary-foreground/20" : "bg-muted")}>
              {f.count}
            </span>
          </button>
        ))}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher…"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Aucune demande pour ce filtre.</p>
          <Button size="sm" onClick={() => navigate({ to: "/agent" })}>Démarrer une demande</Button>
        </Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.pending;
            const Icon = meta.icon;
            const target = r.dossier_id ? `/dossiers/${r.dossier_id}` : `/agent?run=${r.id}`;
            return (
              <li key={r.id}>
                <Link
                  to={target}
                  className="block rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:bg-accent/40"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", meta.tone)}>
                      <Icon className={cn("h-4 w-4", r.status === "running" && "animate-spin")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="truncate font-medium">{r.title || r.message.slice(0, 80)}</h3>
                        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.updated_at ?? r.created_at)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{r.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className={cn("border-0", meta.tone)}>{meta.label}</Badge>
                        {r.intent && <Badge variant="outline" className="text-xs">{r.intent}</Badge>}
                        {r.domain && <Badge variant="outline" className="text-xs">{r.domain}</Badge>}
                        {r.dossier_id && <Badge variant="outline" className="text-xs">Lié à un dossier</Badge>}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
