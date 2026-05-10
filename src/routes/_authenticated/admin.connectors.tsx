import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Key,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  checkConnectorSecrets,
  getConnectorStats,
  listConnectorErrors,
  listConnectorJobs,
  triggerConnector,
  type ConnectorErrorRow,
} from "@/server/connectors.functions";

export const Route = createFileRoute("/_authenticated/admin/connectors")({
  head: () => ({ meta: [{ title: "Connecteurs data · JurisAI" }] }),
  component: ConnectorsAdminPage,
});

const CONNECTORS = [
  {
    id: "kali-full" as const,
    name: "KALI-FULL — Conventions Collectives (par article)",
    description: "Walks unist tree → 1 row par article, section_path, content_hash incrémental, batch resumable.",
    auth: false,
    defaultPayload: { mode: "all" as const },
    badge: "Sans auth · Batch",
  },
  {
    id: "legifrance-full" as const,
    name: "LÉGIFRANCE-FULL — Codes (par article)",
    description: "Walks tableMatieres → 1 row par article avec section_path. SHA-256 incrémental, batch resumable.",
    auth: true,
    defaultPayload: { codes: ["LEGITEXT000006072050"], dry_run: false },
    badge: "OAuth PISTE · Batch",
  },
  {
    id: "judilibre-full" as const,
    name: "JUDILIBRE-FULL — Cour de cassation",
    description: "Toutes chambres, 5 ans. Batch resumable, SHA-256 incrémental.",
    auth: true,
    defaultPayload: { chambers: ["soc", "comm", "civ1", "civ2", "civ3", "crim"], max_decisions: 1000, dry_run: false },
    badge: "KeyId PISTE · Batch",
  },
  {
    id: "jade-full" as const,
    name: "JADE-FULL — Conseil d'État",
    description: "Jurisprudence administrative via PISTE Jade. Batch resumable.",
    auth: true,
    defaultPayload: { max_decisions: 500, dry_run: false },
    badge: "KeyId PISTE · Batch",
  },
  {
    id: "bofip-full" as const,
    name: "BOFIP-FULL — Doctrine fiscale",
    description: "Bulletin officiel des finances publiques via PISTE. Batch resumable.",
    auth: true,
    defaultPayload: { max_docs: 500, dry_run: false },
    badge: "OAuth PISTE · Batch",
  },
  {
    id: "cdtn-fiches" as const,
    name: "CDTN — Fiches Service-Public + Ministère du Travail",
    description: "Fiches pratiques officielles (~3000 fiches). Batch resumable.",
    auth: false,
    defaultPayload: { dry_run: false },
    badge: "Sans auth · Batch",
  },
  {
    id: "cdtn-modeles-full" as const,
    name: "CDTN-MODELES-FULL — Modèles courriers RH",
    description: "Lettres-types depuis code.travail.gouv.fr (items.json). Batch resumable, SHA-256 incrémental.",
    auth: false,
    defaultPayload: { dry_run: false },
    badge: "Sans auth · Batch",
  },
  {
    id: "cdtn-contributions-full" as const,
    name: "CDTN-CONTRIBUTIONS-FULL — Q/R officielles",
    description: "Q/R rédigées par les juristes du Ministère du travail (GitHub SocialGouv). Batch resumable.",
    auth: false,
    defaultPayload: { dry_run: false },
    badge: "Sans auth · Batch",
  },
  {
    id: "cnil-full" as const,
    name: "CNIL-FULL — Délibérations & sanctions",
    description: "Doctrine RGPD officielle, batch resumable, dédup SHA-256.",
    auth: false,
    defaultPayload: { types: ["deliberation", "sanction"], max_per_type: 500, dry_run: false },
    badge: "Sans auth · Batch",
  },
  {
    id: "dole-full" as const,
    name: "DOLE-FULL — Dossiers législatifs",
    description: "Veille proactive sur les lois en préparation (Légifrance DOLE). Batch resumable.",
    auth: true,
    defaultPayload: { months: 24, max_dossiers: 500, dry_run: false },
    badge: "OAuth PISTE · Batch",
  },
  {
    id: "acco-full" as const,
    name: "ACCO-FULL — Accords d'entreprise",
    description: "Accords d'entreprise déposés (PISTE Légifrance fond ACCO). Batch resumable, SHA-256.",
    auth: true,
    defaultPayload: { query: "télétravail", months: 12, max_accords: 500, dry_run: false },
    badge: "OAuth PISTE · Batch",
  },
];

function ConnectorsAdminPage() {
  const qc = useQueryClient();
  const [errorDenied, setErrorDenied] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ["admin", "connector-stats"],
    queryFn: () => getConnectorStats(),
    retry: false,
  });

  const jobsQuery = useQuery({
    queryKey: ["admin", "connector-jobs"],
    queryFn: () => listConnectorJobs(),
    refetchInterval: 5000,
    retry: false,
  });

  const errorsQuery = useQuery({
    queryKey: ["admin", "connector-errors"],
    queryFn: () => listConnectorErrors({ data: {} }),
    retry: false,
  });

  const secretsQuery = useQuery({
    queryKey: ["admin", "connector-secrets"],
    queryFn: () => checkConnectorSecrets(),
    retry: false,
  });

  // Detect access denied error
  useEffect(() => {
    const err = statsQuery.error || jobsQuery.error || secretsQuery.error;
    if (err && err.message.includes("super-administrateurs")) {
      setErrorDenied(err.message);
    }
  }, [statsQuery.error, jobsQuery.error, secretsQuery.error]);

  const triggerMut = useMutation({
    mutationFn: (vars: { connector: typeof CONNECTORS[number]["id"]; payload: Record<string, unknown> }) =>
      triggerConnector({ data: vars }),
    onSuccess: (res, vars) => {
      if (res.ok === false) {
        toast.error(`Connecteur ${vars.connector} indisponible`, {
          description: (res.error ?? "Erreur inconnue").slice(0, 200),
        });
      } else {
        toast.success(`Connecteur ${vars.connector} lancé`, {
          description: JSON.stringify(res.result ?? {}).slice(0, 120),
        });
      }
      qc.invalidateQueries({ queryKey: ["admin", "connector-jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "connector-stats"] });
    },
    onError: (err: Error) => {
      toast.error("Erreur lancement", { description: err.message.slice(0, 200) });
    },
  });

  if (errorDenied) {
    return (
      <AppShell>
        <div className="glass-panel rounded-3xl p-8 text-center">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h1 className="text-2xl font-semibold">Accès refusé</h1>
          <p className="mt-2 text-muted-foreground">{errorDenied}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 overflow-y-auto pr-1">
        <header className="glass-panel rounded-3xl p-6">
          <div className="flex items-center gap-3">
            <Database className="h-6 w-6 text-accent" />
            <div>
              <h1 className="text-2xl font-semibold">Connecteurs data</h1>
              <p className="text-sm text-muted-foreground">
                Sources juridiques officielles → ingestion + embeddings + RAG
              </p>
            </div>
          </div>
        </header>

        {/* Stats */}
        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Sources légales" value={statsQuery.data?.total_sources ?? "—"} loading={statsQuery.isLoading} />
          <StatCard label="Chunks vectorisés" value={statsQuery.data?.total_chunks ?? "—"} loading={statsQuery.isLoading} />
          <StatCard label="Conventions coll." value={statsQuery.data?.total_conventions ?? "—"} loading={statsQuery.isLoading} />
          <StatCard label="Modèles publics" value={statsQuery.data?.total_templates ?? "—"} loading={statsQuery.isLoading} />
        </section>

        {/* Secrets check */}
        <Card className="glass-panel border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" /> Credentials PISTE requis
            </CardTitle>
            <CardDescription>
              Inscription sur{" "}
              <a href="https://piste.gouv.fr/registration" target="_blank" rel="noreferrer" className="underline">
                piste.gouv.fr
              </a>{" "}
              · souscrire APIs Légifrance + Judilibre · ajouter les secrets dans Supabase.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {(secretsQuery.data?.required ?? []).map((s) => (
                <li key={s.name} className="flex items-center justify-between rounded-lg border border-border/30 px-3 py-2">
                  <div>
                    <code className="text-xs font-mono">{s.name}</code>
                    <span className="ml-2 text-muted-foreground">— {s.description}</span>
                  </div>
                  <Badge variant="outline">{s.connector}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Connectors */}
        <section className="grid gap-4 md:grid-cols-2">
          {CONNECTORS.map((c) => (
            <ConnectorCard
              key={c.id}
              connector={c}
              onRun={(payload) => triggerMut.mutate({ connector: c.id, payload })}
              loading={triggerMut.isPending && triggerMut.variables?.connector === c.id}
              sourcesCount={statsQuery.data?.sources_by_connector?.[c.id] ?? 0}
            />
          ))}
        </section>

        {/* Jobs */}
        <Card className="glass-panel border-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Jobs récents</CardTitle>
              <CardDescription>Auto-refresh toutes les 5 secondes</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["admin", "connector-jobs"] })}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {jobsQuery.isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Chargement…
              </div>
            ) : jobsQuery.data?.jobs.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Aucun job</div>
            ) : (
              <div className="space-y-2">
                {jobsQuery.data?.jobs.map((j) => <JobRow key={j.id} job={j} />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Errors */}
        {(errorsQuery.data?.errors?.length ?? 0) > 0 && (
          <Card className="glass-panel border-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Erreurs récentes ({errorsQuery.data?.errors.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                {errorsQuery.data?.errors.slice(0, 20).map((e: ConnectorErrorRow) => (
                  <div key={e.id} className="rounded-lg border border-border/30 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{e.connector}</Badge>
                      <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("fr-FR")}</span>
                    </div>
                    <div className="mt-1 font-mono text-foreground">{e.error_type}: {e.error_message.slice(0, 200)}</div>
                    {e.external_id && <div className="text-muted-foreground">id: {e.external_id}</div>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number | string; loading?: boolean }) {
  return (
    <Card className="glass-panel border-0">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectorCard({
  connector,
  onRun,
  loading,
  sourcesCount,
}: {
  connector: typeof CONNECTORS[number];
  onRun: (payload: Record<string, unknown>) => void;
  loading: boolean;
  sourcesCount: number;
}) {
  const [payload, setPayload] = useState(JSON.stringify(connector.defaultPayload, null, 2));

  return (
    <Card className="glass-panel border-0">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{connector.name}</CardTitle>
            <CardDescription>{connector.description}</CardDescription>
          </div>
          <Badge variant={connector.auth ? "secondary" : "default"}>{connector.badge}</Badge>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {sourcesCount} source(s) déjà ingérée(s)
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Payload JSON</Label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mt-1 h-24 w-full rounded-md border border-border/30 bg-background/50 p-2 font-mono text-xs"
          />
        </div>
        <Button
          onClick={() => {
            try {
              const parsed = JSON.parse(payload);
              onRun(parsed);
            } catch {
              toast.error("JSON invalide");
            }
          }}
          disabled={loading}
          className="w-full"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
          Lancer l'ingestion
        </Button>
      </CardContent>
    </Card>
  );
}

type Job = {
  id: string;
  connector: string | null;
  status: string;
  job_type: string | null;
  items_total: number | null;
  items_processed: number | null;
  items_failed: number | null;
  completed_at: string | null;
  created_at: string;
};

function JobRow({ job }: { job: Job }) {
  const icon = job.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
    job.status === "failed" ? <XCircle className="h-4 w-4 text-destructive" /> :
    job.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> :
    <Clock className="h-4 w-4 text-muted-foreground" />;
  const total = job.items_total ?? 0;
  const done = job.items_processed ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border/30 px-3 py-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{job.connector ?? job.job_type}</span>
          <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(job.created_at).toLocaleString("fr-FR")}
        </span>
      </div>
      {total > 0 && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {done}/{total} traités · {job.items_failed ?? 0} échecs
          </div>
        </div>
      )}
    </div>
  );
}
