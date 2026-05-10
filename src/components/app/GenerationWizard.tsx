// Wizard de génération de documents : Comprendre → (Sourcer) → Préparer → Valider → Exécuter → Archiver → Suivre.
// Multi-domaines (RH, Commercial, Sociétés, RGPD, Fiscal, Contentieux).
// Supporte 3 scénarios : sans dépôt / avec dépôt obligatoire / dépôt optionnel.

import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  X, Loader2, Sparkles, ShieldAlert, ChevronRight, ChevronLeft,
  FileText, BookOpen, Upload, Wand2, AlertTriangle, Bell, CheckCircle2,
} from "lucide-react";
import {
  startGenerationSession,
  updateGenerationSession,
  finalizeGeneration,
  fetchTemplateLegalSources,
} from "@/server/generation.functions";
import {
  PREFILL_SOURCE_LABELS,
  shouldRequestValidation,
  type DocumentScenario,
  type TemplateField,
  type PrefillSource,
} from "@/lib/templates/template-config";

type LegalSource = { id: string; title: string; label?: string; url?: string; excerpt?: string };

type Template = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  risk_level: string;
  body: string;
  variables: TemplateField[] | unknown;
  legal_basis: Array<{ label: string; reference?: string }> | unknown;
  // Config étendue
  requires_upload?: boolean;
  upload_optional?: boolean;
  requires_form?: boolean;
  requires_rag?: boolean;
  requires_validation?: boolean;
  archive_to_case?: boolean;
  can_create_reminder?: boolean;
  reminder_days_default?: number | null;
  output_formats?: string[];
  prefill_sources?: PrefillSource[];
  guidance?: string | null;
  validation_threshold?: "auto" | "always" | "never";
};

type Props = {
  template: Template;
  dossierId?: string;
  uploadedAnalysisId?: string;
  onClose: () => void;
};

type Step = "scenario" | "collect" | "sources" | "review" | "generating" | "done";

export function GenerationWizard({ template, dossierId, uploadedAnalysisId, onClose }: Props) {
  const start = useServerFn(startGenerationSession);
  const update = useServerFn(updateGenerationSession);
  const finalize = useServerFn(finalizeGeneration);
  const fetchSources = useServerFn(fetchTemplateLegalSources);
  const navigate = useNavigate();

  const variables: TemplateField[] = useMemo(
    () => (Array.isArray(template.variables) ? (template.variables as TemplateField[]) : []),
    [template.variables],
  );
  const legalBasis = Array.isArray(template.legal_basis) ? template.legal_basis : [];
  const outputFormats = template.output_formats?.length ? template.output_formats : ["html"];
  const enabledSources: PrefillSource[] = template.prefill_sources ?? [];

  // Scénario initial
  const initialScenario: DocumentScenario = template.requires_upload
    ? "from_upload"
    : dossierId ? "from_dossier" : "no_upload";

  const requiresValidation = shouldRequestValidation(template.risk_level, {
    requires_validation: !!template.requires_validation,
    validation_threshold: template.validation_threshold ?? "auto",
  });

  const needsScenarioStep = !!template.upload_optional && !template.requires_upload;
  const [step, setStep] = useState<Step>(needsScenarioStep ? "scenario" : "collect");
  const [scenario, setScenario] = useState<DocumentScenario>(initialScenario);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, string>>({});
  const [prefillMeta, setPrefillMeta] = useState<Record<string, { source: PrefillSource; confidence?: number }>>({});
  const [uncertain, setUncertain] = useState<Array<{ key: string; reason: string }>>([]);
  const [legalSources, setLegalSources] = useState<LegalSource[]>([]);
  const [ragQuery, setRagQuery] = useState<string>(template.name);
  const [outputFormat, setOutputFormat] = useState<string>(outputFormats[0]);
  const [aiPolish, setAiPolish] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [reminderDays, setReminderDays] = useState<string>(
    template.can_create_reminder && template.reminder_days_default ? String(template.reminder_days_default) : "",
  );
  const [busy, setBusy] = useState(false);

  // Crée la session au montage (ou à choix de scénario)
  useEffect(() => {
    if (step === "scenario") return;
    if (sessionId) return;
    void (async () => {
      try {
        const r = await start({
          data: {
            template_id: template.id,
            dossier_id: dossierId,
            scenario,
            uploaded_document_analysis_id: uploadedAnalysisId,
            prefilled_data: {},
          },
        });
        setSessionId(r.session_id);
        const pre: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.prefilled_data ?? {})) {
          if (v != null) pre[k] = String(v);
        }
        setData(pre);
        setPrefillMeta(r.prefill_metadata as any);
        setUncertain(r.uncertain_fields ?? []);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur ouverture session");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, scenario]);

  const missing = variables.filter((v) => v.required && !data[v.key]);

  async function handleStartFromScenario() {
    setStep("collect");
  }

  async function handleAfterCollect() {
    if (!sessionId) return;
    if (missing.length > 0) {
      toast.error(`${missing.length} champ(s) requis manquant(s)`);
      return;
    }
    setBusy(true);
    try {
      await update({
        data: { id: sessionId, collected_data: data, current_step: template.requires_rag ? "fetch_sources" : "review" },
      });
      setStep(template.requires_rag ? "sources" : "review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function handleFetchSources() {
    if (!sessionId) return;
    setBusy(true);
    try {
      const r = await fetchSources({ data: { session_id: sessionId, query: ragQuery } });
      setLegalSources(r.sources as LegalSource[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur RAG");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!sessionId) return;
    setStep("generating");
    setBusy(true);
    try {
      const remDays = reminderDays ? parseInt(reminderDays, 10) : null;
      const r = await finalize({
        data: {
          session_id: sessionId,
          ai_polish: aiPolish,
          ai_instruction: aiInstruction || undefined,
          output_format: outputFormat as any,
          reminder_after_days: remDays && remDays > 0 ? remDays : null,
        },
      });
      setStep("done");
      if (r.status === "pending_validation") {
        toast.success("Document généré — validation hiérarchique demandée");
      } else {
        toast.success("Document généré");
      }
      // R63 (BUG-G9) — timeout traçable, nettoyé si le composant est démonté.
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
        navigate({ to: "/documents" });
      }, 1300);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur génération");
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="relative flex h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold leading-tight">{template.name}</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {template.category} · risque {template.risk_level}
                {requiresValidation && <span className="ml-2 text-amber-600">· validation requise</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Stepper */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-[11px] font-medium uppercase tracking-wider">
          {needsScenarioStep && (
            <>
              <span className={step === "scenario" ? "text-accent" : "text-muted-foreground"}>1. Scénario</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </>
          )}
          <span className={step === "collect" ? "text-accent" : "text-muted-foreground"}>Collecter</span>
          {template.requires_rag && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className={step === "sources" ? "text-accent" : "text-muted-foreground"}>Sources</span>
            </>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className={step === "review" ? "text-accent" : "text-muted-foreground"}>Vérifier</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className={step === "generating" || step === "done" ? "text-accent" : "text-muted-foreground"}>Générer</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === "scenario" && (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">Comment souhaitez-vous démarrer ?</p>
              {[
                { v: "no_upload" as DocumentScenario, label: "Sans document de base", desc: "Saisie manuelle / pré-remplissage depuis le dossier." },
                { v: "from_upload" as DocumentScenario, label: "À partir d'un document déposé", desc: "Extraction OCR + champs auto-remplis." },
                ...(dossierId ? [{ v: "from_dossier" as DocumentScenario, label: "À partir du dossier courant", desc: "Pré-remplissage maximum depuis le contexte du dossier." }] : []),
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setScenario(opt.v)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                    scenario === opt.v ? "border-accent bg-accent/5" : "border-border hover:bg-secondary/50"
                  }`}
                >
                  <Upload className="mt-0.5 h-4 w-4 text-accent" />
                  <div>
                    <div className="text-[13px] font-semibold">{opt.label}</div>
                    <div className="text-[11.5px] text-muted-foreground">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === "collect" && (
            <div className="space-y-4">
              {template.guidance && (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-[12.5px] text-foreground/80">
                  💡 {template.guidance}
                </div>
              )}

              {legalBasis.length > 0 && (
                <div className="rounded-xl border border-border bg-secondary/40 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    <BookOpen className="h-3 w-3" /> Bases légales applicables
                  </div>
                  <ul className="space-y-0.5">
                    {legalBasis.map((b: any, i: number) => (
                      <li key={i} className="text-[12px] text-foreground/80">
                        • {b.label} {b.reference ? `(${b.reference})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Object.keys(prefillMeta).length > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12px] text-emerald-700 dark:text-emerald-400">
                  <Wand2 className="mr-1 inline h-3.5 w-3.5" />
                  {Object.keys(prefillMeta).length} champ(s) pré-rempli(s) automatiquement depuis :{" "}
                  {Array.from(new Set(Object.values(prefillMeta).map((m) => PREFILL_SOURCE_LABELS[m.source]))).join(", ")}
                </div>
              )}

              {uncertain.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  {uncertain.length} champ(s) à vérifier : {uncertain.map((u) => u.key).join(", ")}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {variables.map((v) => {
                  const meta = prefillMeta[v.key];
                  const isWide = v.type === "textarea" || v.type === "multi_select";
                  return (
                    <div key={v.key} className={isWide ? "sm:col-span-2" : ""}>
                      <label className="mb-1 flex items-center justify-between text-[12px] font-medium">
                        <span>
                          {v.label}
                          {v.required && <span className="text-destructive"> *</span>}
                        </span>
                        {meta && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                            {PREFILL_SOURCE_LABELS[meta.source]}
                            {meta.confidence != null ? ` ${Math.round(meta.confidence * 100)}%` : ""}
                          </span>
                        )}
                      </label>
                      {v.hint && <p className="mb-1 text-[10.5px] text-muted-foreground">{v.hint}</p>}
                      {v.type === "textarea" ? (
                        <textarea
                          value={data[v.key] ?? ""}
                          onChange={(e) => setData({ ...data, [v.key]: e.target.value })}
                          rows={3}
                          placeholder={v.placeholder}
                          className="input-base"
                        />
                      ) : v.type === "select" ? (
                        <select
                          value={data[v.key] ?? ""}
                          onChange={(e) => setData({ ...data, [v.key]: e.target.value })}
                          className="input-base"
                        >
                          <option value="">— sélectionner —</option>
                          {(v.options ?? []).map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : v.type === "boolean" ? (
                        <select
                          value={data[v.key] ?? ""}
                          onChange={(e) => setData({ ...data, [v.key]: e.target.value })}
                          className="input-base"
                        >
                          <option value="">—</option>
                          <option value="oui">Oui</option>
                          <option value="non">Non</option>
                        </select>
                      ) : (
                        <input
                          type={v.type === "date" ? "date" : v.type === "number" ? "number" : "text"}
                          value={data[v.key] ?? ""}
                          onChange={(e) => setData({ ...data, [v.key]: e.target.value })}
                          placeholder={v.placeholder}
                          className="input-base"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === "sources" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-[12.5px]">
                <BookOpen className="mr-1 inline h-3.5 w-3.5 text-accent" />
                Récupérer les fondements juridiques applicables avant de générer.
              </div>
              <div className="flex gap-2">
                <input
                  value={ragQuery}
                  onChange={(e) => setRagQuery(e.target.value)}
                  placeholder="Mots-clés juridiques…"
                  className="input-base"
                />
                <button
                  onClick={handleFetchSources}
                  disabled={busy || ragQuery.length < 3}
                  className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-[12px] font-medium hover:bg-secondary disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rechercher"}
                </button>
              </div>
              {legalSources.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Aucune source récupérée pour l'instant.</p>
              ) : (
                <ul className="space-y-2">
                  {legalSources.map((s) => (
                    <li key={s.id} className="rounded-xl border border-border p-3 text-[12px]">
                      <div className="font-semibold">{s.title}</div>
                      {s.label && <div className="text-[10.5px] text-muted-foreground">{s.label}</div>}
                      {s.excerpt && <p className="mt-1 text-foreground/70">{s.excerpt}…</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div className={`rounded-xl border p-3 text-[12.5px] ${requiresValidation ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"}`}>
                <ShieldAlert className="mr-1 inline h-4 w-4" />
                {requiresValidation
                  ? "Document à risque élevé : une demande de validation hiérarchique sera créée automatiquement."
                  : "Document à risque maîtrisé : génération directe en brouillon."}
              </div>

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Valeurs collectées
                </h4>
                <dl className="grid gap-1.5 sm:grid-cols-2">
                  {variables.map((v) => (
                    <div key={v.key} className="text-[12.5px]">
                      <dt className="text-muted-foreground">{v.label}</dt>
                      <dd className="font-medium">{data[v.key] || <em className="text-amber-600">(vide)</em>}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {legalSources.length > 0 && (
                <div className="rounded-xl border border-border p-3">
                  <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Sources juridiques rattachées ({legalSources.length})
                  </h4>
                  <ul className="space-y-1 text-[12px]">
                    {legalSources.slice(0, 5).map((s) => (
                      <li key={s.id} className="text-foreground/80">• {s.title}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {outputFormats.length > 1 && (
                  <div>
                    <label className="mb-1 block text-[12px] font-medium">Format de sortie</label>
                    <select
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value)}
                      className="input-base"
                    >
                      {outputFormats.map((f) => (
                        <option key={f} value={f}>{f.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                )}
                {(template.can_create_reminder || template.archive_to_case !== false) && dossierId && (
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[12px] font-medium">
                      <Bell className="h-3.5 w-3.5" /> Rappel de suivi (jours)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={reminderDays}
                      onChange={(e) => setReminderDays(e.target.value)}
                      placeholder="ex : 30"
                      className="input-base"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border p-3">
                <label className="flex items-start gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={aiPolish}
                    onChange={(e) => setAiPolish(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="flex items-center gap-1 font-medium">
                      <Sparkles className="h-3.5 w-3.5 text-accent" /> Améliorer le style avec l'IA
                    </span>
                    <span className="text-[11.5px] text-muted-foreground">
                      L'IA conserve la structure et les valeurs factuelles.
                    </span>
                  </span>
                </label>
                {aiPolish && (
                  <textarea
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    placeholder="Instruction (ex : ton plus formel, raccourcir l'introduction…)"
                    rows={2}
                    className="input-base mt-2"
                  />
                )}
              </div>
            </div>
          )}

          {step === "generating" && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <p className="text-[13px] text-muted-foreground">Génération en cours…</p>
            </div>
          )}

          {step === "done" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="text-[14px] font-medium">Document généré avec succès</p>
              <p className="text-[12px] text-muted-foreground">Redirection vers vos documents…</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== "generating" && step !== "done" && (
          <footer className="flex items-center justify-between gap-3 border-t border-border p-4">
            {step === "collect" && needsScenarioStep ? (
              <button
                onClick={() => setStep("scenario")}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:bg-secondary"
              >
                <ChevronLeft className="h-4 w-4" /> Scénario
              </button>
            ) : step === "sources" ? (
              <button
                onClick={() => setStep("collect")}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:bg-secondary"
              >
                <ChevronLeft className="h-4 w-4" /> Champs
              </button>
            ) : step === "review" ? (
              <button
                onClick={() => setStep(template.requires_rag ? "sources" : "collect")}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:bg-secondary"
              >
                <ChevronLeft className="h-4 w-4" /> Modifier
              </button>
            ) : (
              <span className="text-[11.5px] text-muted-foreground">
                {step === "collect" && missing.length > 0 ? `${missing.length} champ(s) requis manquant(s)` : ""}
              </span>
            )}

            <button
              onClick={
                step === "scenario" ? handleStartFromScenario
                : step === "collect" ? handleAfterCollect
                : step === "sources" ? () => setStep("review")
                : handleGenerate
              }
              disabled={busy || (step === "collect" && missing.length > 0)}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:bg-accent/90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {step === "scenario" ? "Continuer" : step === "collect" ? "Continuer" : step === "sources" ? "Vérifier" : "Générer le document"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
