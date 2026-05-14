import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Sparkles, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  generateWorkflow,
  listGenerationRuns,
  setWorkflowLifecycleStatus,
} from "@/lib/server-fns/workflow-generator.functions";
import { WorkflowStatusBanner } from "@/components/agent/WorkflowStatusBanner";
import { SmartDisclaimer } from "@/components/agent/SmartDisclaimer";

export const Route = createFileRoute("/_authenticated/admin/workflow-generator")({
  component: WorkflowGeneratorPage,
});

const CATEGORIES = ["rh","commercial","societes","rgpd","fiscal","contentieux","administratif","contrats","reglementation","autre"];

function WorkflowGeneratorPage() {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<string>("");
  const [dryRun, setDryRun] = useState(false);

  const runsQ = useQuery({
    queryKey: ["wf-gen-runs"],
    queryFn: () => listGenerationRuns({ data: { limit: 30 } }),
    refetchInterval: 5000,
  });

  const genM = useMutation({
    mutationFn: () => generateWorkflow({ data: { prompt, category: category || undefined, dryRun } }),
    onSuccess: (res) => {
      if (res.error) toast.error(`Échec : ${res.error}`);
      else if (res.cache_hit) toast.info(`Cache : workflow existant réutilisé (similarité ${(res.duplicate_of?.similarity ?? 0).toFixed(2)}).`);
      else toast.success(`Workflow généré — statut : ${res.quality?.auto_status ?? "?"}`);
      qc.invalidateQueries({ queryKey: ["wf-gen-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validateM = useMutation({
    mutationFn: (vars: { definitionId: string; status: "human_validated" | "rejected"; reason?: string }) =>
      setWorkflowLifecycleStatus({ data: vars }),
    onSuccess: () => {
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["wf-gen-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="flex items-center gap-3">
            <Sparkles className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">Générateur de workflows IA</h1>
              <p className="text-sm text-muted-foreground">
                Génération illimitée + validation 3 couches (RAG, consensus LLM, sécurité). Aucun workflow IA n'est utilisable sans validation humaine, sauf si tous les seuils auto sont atteints et qu'aucune action critique n'est détectée.
              </p>
            </div>
          </header>

          <Card>
            <CardHeader><CardTitle className="text-base">Nouvelle génération</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Décris la procédure à générer (ex : « Procédure complète pour un licenciement pour faute grave d'un salarié en CDI »)"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={2000}
              />
              <div className="flex items-center gap-3">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Catégorie (optionnelle)" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                  Dry-run (preview sans persistance)
                </label>
                <div className="ml-auto">
                  <Button
                    onClick={() => genM.mutate()}
                    disabled={genM.isPending || prompt.trim().length < 10}
                  >
                    {genM.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    Générer
                  </Button>
                </div>
              </div>

              {genM.data && !genM.data.error && (
                <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 text-sm space-y-3">
                  <WorkflowStatusBanner
                    status={genM.data.cache_hit ? "human_validated" : (genM.data.quality?.auto_status ?? "draft_ai")}
                    riskLevel={genM.data.quality?.sensitive?.max_severity}
                    validationRequired={genM.data.quality?.sensitive?.contains_sensitive}
                    sources_count={genM.data.quality?.scores ? undefined : undefined}
                    quality_score={genM.data.quality?.scores?.overall ? Math.round(genM.data.quality.scores.overall) : undefined}
                  />
                  <SmartDisclaimer
                    status={genM.data.cache_hit ? "human_validated" : (genM.data.quality?.auto_status ?? "draft_ai") as any}
                    maxSeverity={(genM.data.quality?.sensitive?.max_severity ?? "none") as any}
                    sensitiveCount={genM.data.quality?.sensitive?.detected?.length ?? 0}
                  />
                  <div className="flex items-center gap-2">
                    <strong>Résultat :</strong>
                    {genM.data.cache_hit ? (
                      <Badge variant="secondary">Cache hit — similarité {(genM.data.duplicate_of?.similarity ?? 0).toFixed(2)}</Badge>
                    ) : (
                      <StatusBadge status={genM.data.quality?.auto_status ?? "draft_ai"} />
                    )}
                  </div>
                  {genM.data.quality && (
                    <ScoreGrid scores={genM.data.quality.scores} />
                  )}
                  {genM.data.quality?.sensitive.contains_sensitive && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                      <strong>⚠ Actions sensibles détectées :</strong>{" "}
                      {genM.data.quality.sensitive.detected.map((d) => `${d.action_label} (${d.severity})`).join(", ")}
                    </div>
                  )}
                  {genM.data.quality?.reasons?.length ? (
                    <ul className="list-disc pl-5 text-xs text-muted-foreground">
                      {genM.data.quality.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  ) : null}
                  {genM.data.workflow_definition_id && (
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="default"
                        onClick={() => validateM.mutate({ definitionId: genM.data!.workflow_definition_id!, status: "human_validated" })}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Valider (human_validated)
                      </Button>
                      <Button size="sm" variant="destructive"
                        onClick={() => validateM.mutate({ definitionId: genM.data!.workflow_definition_id!, status: "rejected", reason: "Rejet manuel admin" })}>
                        <XCircle className="h-4 w-4 mr-1" /> Rejeter
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Historique des générations</CardTitle></CardHeader>
            <CardContent>
              {runsQ.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {runsQ.data && runsQ.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune génération pour l'instant.</p>
              )}
              <div className="space-y-2">
                {(runsQ.data ?? []).map((r: any) => (
                  <div key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <RunStatusIcon status={r.status} />
                        <span className="font-medium truncate max-w-md">{r.prompt}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {r.cache_hit && <Badge variant="secondary">cache</Badge>}
                        {r.scores?.overall != null && <Badge variant="outline">score {Math.round(r.scores.overall)}</Badge>}
                        <span>{new Date(r.created_at).toLocaleString("fr-FR")}</span>
                      </div>
                    </div>
                    {r.error_message && <p className="mt-1 text-xs text-destructive">{r.error_message}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    ai_validated_auto:    { label: "Auto-validé IA",        cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: ShieldCheck },
    pending_human_review: { label: "Revue humaine requise", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",       icon: AlertTriangle },
    draft_ai:             { label: "Brouillon IA",          cls: "bg-muted text-muted-foreground",                            icon: Clock },
    human_validated:      { label: "Validé humain",         cls: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
    rejected:             { label: "Rejeté",                cls: "bg-destructive/15 text-destructive",                        icon: XCircle },
  };
  const cfg = map[status] ?? map.draft_ai;
  const Icon = cfg.icon;
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cfg.cls}`}><Icon className="h-3 w-3" />{cfg.label}</span>;
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed")    return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "running")   return <Loader2 className="h-4 w-4 animate-spin" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function ScoreGrid({ scores }: { scores: { legal_refs: number; logic: number; documents: number; completeness: number; safety: number; overall: number } }) {
  const items: Array<[string, number]> = [
    ["Refs légales", scores.legal_refs],
    ["Logique",     scores.logic],
    ["Documents",   scores.documents],
    ["Complétude",  scores.completeness],
    ["Sécurité",    scores.safety],
    ["Global",      scores.overall],
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-md border border-border bg-background p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
          <div className={`text-sm font-semibold ${v >= 80 ? "text-emerald-600" : v >= 60 ? "text-amber-600" : "text-destructive"}`}>{Math.round(v)}</div>
        </div>
      ))}
    </div>
  );
}
