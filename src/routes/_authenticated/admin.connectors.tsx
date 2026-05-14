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
  Eye,
  EyeOff,
  Copy,
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
  countEmptySources,
  deleteConnectorJob,
  deleteFailedConnectorJobs,
  getConnectorStats,
  listConnectorErrors,
  listConnectorJobs,
  retryEmptySources,
  triggerConnector,
  type ConnectorErrorRow,
} from "@/lib/server-fns/connectors.functions";
import { Trash2, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/connectors")({
  head: () => ({ meta: [{ title: "Connecteurs data · JurisAI" }] }),
  component: ConnectorsAdminPage,
});

const CONNECTORS = [
  {
    id: "kali-full" as const,
    name: "Conventions collectives (KALI)",
    description: "Toutes les conventions collectives nationales (texte de base + avenants), ingérées article par article. Sert à répondre aux questions RH liées à une CC précise.",
    source: "Légifrance · fonds KALI (data.gouv.fr)",
    auth: false,
    defaultPayload: { mode: "all" as const },
    badge: "Source publique",
  },
  {
    id: "legifrance-full" as const,
    name: "Codes juridiques (Légifrance)",
    description: "Codes français (Code du travail, Code civil, Code de commerce, etc.) ingérés article par article avec leur arborescence (livre/titre/chapitre).",
    source: "Légifrance · API PISTE",
    auth: true,
    defaultPayload: { codes: ["LEGITEXT000006072050"], dry_run: false },
    badge: "API Légifrance (OAuth)",
  },
  {
    id: "judilibre-full" as const,
    name: "Jurisprudence Cour de cassation (Judilibre)",
    description: "Décisions de la Cour de cassation des 5 dernières années, toutes chambres (sociale, commerciale, civile, criminelle). Sert à sourcer la jurisprudence.",
    source: "Cour de cassation · API Judilibre (PISTE)",
    auth: true,
    defaultPayload: { chambers: ["soc", "comm", "civ1", "civ2", "civ3", "cr"], max_decisions: 0, dry_run: false },
    badge: "API PISTE (clé)",
  },
  {
    id: "jade-full" as const,
    name: "Jurisprudence administrative (JADE)",
    description: "Décisions du Conseil d'État et des juridictions administratives. Pour le contentieux administratif et la fonction publique.",
    source: "Conseil d'État · API JADE (PISTE)",
    auth: true,
    defaultPayload: { max_decisions: 0, dry_run: false },
    badge: "API PISTE (clé)",
  },
  {
    id: "bofip-full" as const,
    name: "Doctrine fiscale (BOFiP)",
    description: "Bulletin officiel des finances publiques : doctrine fiscale officielle opposable à l'administration. Pour les questions fiscales.",
    source: "DGFiP · BOFiP-Impôts (PISTE)",
    auth: true,
    defaultPayload: { dry_run: false },
    badge: "API Légifrance (OAuth)",
  },
  {
    id: "cdtn-fiches" as const,
    name: "Fiches pratiques (Service-Public + Travail)",
    description: "≈3000 fiches pratiques officielles (droits, démarches, obligations) rédigées par le Ministère du Travail et service-public.fr.",
    source: "code.travail.gouv.fr + service-public.fr",
    auth: false,
    defaultPayload: { dry_run: false },
    badge: "Source publique",
  },
  {
    id: "cdtn-modeles-full" as const,
    name: "Modèles de courriers RH",
    description: "Lettres-types officielles (rupture, congés, sanction, etc.) réutilisables comme base pour la génération de documents JurisAI.",
    source: "code.travail.gouv.fr",
    auth: false,
    defaultPayload: { dry_run: false },
    badge: "Source publique",
  },
  {
    id: "cdtn-contributions-full" as const,
    name: "Questions / Réponses juristes (CDTN)",
    description: "Q/R rédigées par les juristes du Ministère du Travail. Réponses concrètes à des cas typiques, avec source officielle.",
    source: "GitHub SocialGouv · code-du-travail-numerique",
    auth: false,
    defaultPayload: { dry_run: false },
    badge: "Source publique",
  },
  {
    id: "cnil-full" as const,
    name: "Délibérations & sanctions CNIL",
    description: "Doctrine RGPD officielle : délibérations, recommandations et sanctions de la CNIL. Pour les questions données personnelles / RGPD.",
    source: "cnil.fr",
    auth: false,
    defaultPayload: { types: ["deliberation", "sanction"], max_per_type: 500, dry_run: false },
    badge: "Source publique",
  },
  {
    id: "dole-full" as const,
    name: "Veille législative (DOLE)",
    description: "Dossiers législatifs en cours : lois en préparation, projets et propositions. Sert à la veille proactive et aux alertes réglementaires.",
    source: "Légifrance · fonds DOLE (PISTE)",
    auth: true,
    defaultPayload: { months: 24, max_dossiers: 500, dry_run: false },
    badge: "API Légifrance (OAuth)",
  },
  {
    id: "acco-full" as const,
    name: "Accords d'entreprise (ACCO)",
    description: "Accords d'entreprise déposés à la DREETS. Utile pour benchmark, précédents et exemples de clauses négociées.",
    source: "Légifrance · fonds ACCO (PISTE)",
    auth: true,
    defaultPayload: { months: 24, max_accords: 10000, dry_run: false },
    badge: "API Légifrance (OAuth)",
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

  const deleteJobMut = useMutation({
    mutationFn: (jobId: string) => deleteConnectorJob({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Job supprimé");
      qc.invalidateQueries({ queryKey: ["admin", "connector-jobs"] });
    },
    onError: (err: Error) => toast.error("Suppression impossible", { description: err.message.slice(0, 200) }),
  });

  const emptySourcesQuery = useQuery({
    queryKey: ["admin", "empty-sources"],
    queryFn: () => countEmptySources(),
    refetchInterval: 30_000,
  });

  const retryEmptyMut = useMutation({
    mutationFn: (connector: "bofip" | "judilibre" | "cdtn-fiches" | "legifrance") =>
      retryEmptySources({ data: { connector } }),
    onSuccess: (res) => {
      if (res.ok === false) {
        toast.error(`Retry ${res.connector} échoué`, { description: (res.error ?? "").slice(0, 200) });
      } else {
        toast.success(`Retry sources vides ${res.connector} lancé`, {
          description: JSON.stringify(res.result ?? {}).slice(0, 120),
        });
      }
      qc.invalidateQueries({ queryKey: ["admin", "connector-jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "empty-sources"] });
      qc.invalidateQueries({ queryKey: ["admin", "connector-stats"] });
    },
    onError: (err: Error) => toast.error("Retry impossible", { description: err.message.slice(0, 200) }),
  });

  const deleteFailedMut = useMutation({
    mutationFn: () => deleteFailedConnectorJobs({ data: {} }),
    onSuccess: () => {
      toast.success("Jobs en échec supprimés");
      qc.invalidateQueries({ queryKey: ["admin", "connector-jobs"] });
    },
    onError: (err: Error) => toast.error("Suppression impossible", { description: err.message.slice(0, 200) }),
  });

  const relaunchConnector = (connectorId: string, jobId?: string) => {
    // Cas spécial : jobs retry-empty-<connector> → on relance via retryEmptySources
    if (connectorId.startsWith("retry-empty-")) {
      const sub = connectorId.slice("retry-empty-".length) as
        | "bofip" | "judilibre" | "cdtn-fiches" | "legifrance";
      if (!["bofip", "judilibre", "cdtn-fiches", "legifrance"].includes(sub)) {
        toast.error(`Retry ${connectorId} non supporté`);
        return;
      }
      retryEmptyMut.mutate(sub);
      return;
    }
    const cfg = CONNECTORS.find((c) => c.id === connectorId);
    if (!cfg) {
      toast.error(`Connecteur ${connectorId} inconnu`);
      return;
    }
    const payload = jobId
      ? { ...(cfg.defaultPayload as Record<string, unknown>), resume_batch_id: jobId }
      : (cfg.defaultPayload as Record<string, unknown>);
    triggerMut.mutate({ connector: cfg.id, payload });
  };

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
              <Key className="h-4 w-4" /> Credentials PISTE
            </CardTitle>
            <CardDescription>
              Inscription sur{" "}
              <a href="https://piste.gouv.fr/registration" target="_blank" rel="noreferrer" className="underline">
                piste.gouv.fr
              </a>{" "}
              · souscrire APIs Légifrance + Judilibre · les valeurs ci-dessous sont injectées depuis les secrets serveur.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {(secretsQuery.data?.required ?? []).map((s) => (
                <SecretRow key={s.name} secret={s} />
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

        {/* Sources vides — retry ciblé */}
        <Card className="glass-panel border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4" /> Sources sans chunks (catalogue à nettoyer)
            </CardTitle>
            <CardDescription>
              Sources légales présentes mais sans contenu vectorisé (contenu trop court ou échec d'embedding).
              Le retry re-fetch chaque source : si toujours vide → suppression du catalogue ; sinon ré-ingestion complète (staging→promote).
              Sans impact sur le RAG ni sur les ingestions en cours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {emptySourcesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : emptySourcesQuery.data && emptySourcesQuery.data.total > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Total : <span className="font-medium text-foreground">{emptySourcesQuery.data.total}</span> sources vides
                </p>
                <ul className="space-y-2">
                  {(["bofip", "judilibre", "cdtn-fiches", "legifrance"] as const).map((conn) => {
                    const count = emptySourcesQuery.data?.by_connector?.[conn] ?? 0;
                    const pending = retryEmptyMut.isPending && retryEmptyMut.variables === conn;
                    return (
                      <li key={conn} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Badge variant="outline">{conn}</Badge>
                          <span className="text-muted-foreground">{count} source{count > 1 ? "s" : ""} vide{count > 1 ? "s" : ""}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={count === 0 || pending}
                          onClick={() => retryEmptyMut.mutate(conn)}
                        >
                          {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wrench className="mr-1 h-3 w-3" />}
                          Réingérer
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {(emptySourcesQuery.data.by_connector?.kali ?? 0) > 0 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Note : kali ({emptySourcesQuery.data.by_connector.kali}) n'est pas couvert par le retry ciblé (walk d'arbre depuis la convention parente requis). Relance complète du connecteur kali si besoin.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune source vide. ✓</p>
            )}
          </CardContent>
        </Card>

        {/* Jobs */}
        <Card className="glass-panel border-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Jobs récents</CardTitle>
              <CardDescription>Auto-refresh toutes les 5 secondes</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteFailedMut.mutate()}
                disabled={deleteFailedMut.isPending || !jobsQuery.data?.jobs.some((j) => j.status === "failed")}
                title="Supprimer tous les jobs en échec"
              >
                <Trash2 className="mr-1 h-4 w-4" /> Échecs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ["admin", "connector-jobs"] })}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
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
                {jobsQuery.data?.jobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onRelaunch={() => j.connector && relaunchConnector(j.connector, j.id)}
                    onDelete={() => deleteJobMut.mutate(j.id)}
                    relaunching={triggerMut.isPending && triggerMut.variables?.connector === j.connector}
                    deleting={deleteJobMut.isPending && deleteJobMut.variables === j.id}
                  />
                ))}
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

function SecretRow({
  secret,
}: {
  secret: { name: string; connector: string; description: string; sensitive?: boolean; present?: boolean; value?: string };
}) {
  const [revealed, setRevealed] = useState(false);
  const value = secret.value ?? "";
  const present = secret.present ?? value.length > 0;
  const masked = value ? "•".repeat(Math.min(value.length, 24)) : "non défini";
  const display = !present ? "non défini" : revealed || !secret.sensitive ? value : masked;

  const copy = async () => {
    if (!present) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${secret.name} copié`);
    } catch {
      toast.error("Copie impossible");
    }
  };

  return (
    <li className="rounded-lg border border-border/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono">{secret.name}</code>
            <Badge variant="outline" className="text-[10px]">{secret.connector}</Badge>
            {!present && <Badge variant="destructive" className="text-[10px]">manquant</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{secret.description}</div>
          <div className="mt-1 break-all font-mono text-xs text-foreground/80">{display}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {secret.sensitive && present && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRevealed((r) => !r)} title={revealed ? "Masquer" : "Afficher"}>
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copy} disabled={!present} title="Copier">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
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
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{connector.name}</CardTitle>
          <Badge variant={connector.auth ? "secondary" : "default"} className="shrink-0">{connector.badge}</Badge>
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Source : {(connector as { source?: string }).source ?? "—"}
        </div>
        <CardDescription className="mt-2">{connector.description}</CardDescription>
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
              const parsed = JSON.parse(payload) as Record<string, unknown> & { chambers?: unknown };
              const normalized = connector.id === "judilibre-full" && Array.isArray(parsed.chambers)
                ? {
                    ...parsed,
                    chambers: parsed.chambers.map((value) => value === "crim" ? "cr" : value),
                  }
                : parsed;

              if (normalized !== parsed) {
                setPayload(JSON.stringify(normalized, null, 2));
              }

              onRun(normalized);
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
  last_tick_at?: string | null;
  created_at: string;
};

function JobRow({
  job,
  onRelaunch,
  onDelete,
  relaunching,
  deleting,
}: {
  job: Job;
  onRelaunch: () => void;
  onDelete: () => void;
  relaunching: boolean;
  deleting: boolean;
}) {
  const icon = job.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
    job.status === "failed" ? <XCircle className="h-4 w-4 text-destructive" /> :
    job.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> :
    <Clock className="h-4 w-4 text-muted-foreground" />;
  const total = job.items_total ?? 0;
  const done = job.items_processed ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const lastTickMs = job.last_tick_at ? new Date(job.last_tick_at).getTime() : 0;
  const staleRunning = job.status === "running" && lastTickMs > 0 && (Date.now() - lastTickMs) > 5 * 60 * 1000;
  const canRelaunch = !!job.connector && (job.status !== "running" || staleRunning);

  return (
    <div className="rounded-lg border border-border/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate font-medium">{job.connector ?? job.job_type}</span>
          <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {new Date(job.created_at).toLocaleString("fr-FR")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onRelaunch}
            disabled={!canRelaunch || relaunching}
            title="Relancer maintenant"
          >
            {relaunching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={deleting}
            title="Supprimer ce job"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
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
