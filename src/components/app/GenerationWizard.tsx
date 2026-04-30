// Wizard de génération de documents : Comprendre → Préparer → (Valider) → Exécuter.
// Multi-domaines (RH, Commercial, Sociétés, RGPD, Fiscal, Contentieux).

import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { X, Loader2, Sparkles, ShieldAlert, ChevronRight, ChevronLeft, FileText, BookOpen } from "lucide-react";
import { startGenerationSession, updateGenerationSession, finalizeGeneration } from "@/server/generation.functions";

type Variable = {
  key: string;
  label: string;
  type: "text" | "date" | "number" | "select" | "textarea";
  required?: boolean;
  options?: string[];
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  risk_level: string;
  body: string;
  variables: Variable[] | unknown;
  legal_basis: Array<{ label: string; reference?: string }> | unknown;
};

type Props = {
  template: Template;
  dossierId?: string;
  onClose: () => void;
};

export function GenerationWizard({ template, dossierId, onClose }: Props) {
  const start = useServerFn(startGenerationSession);
  const update = useServerFn(updateGenerationSession);
  const finalize = useServerFn(finalizeGeneration);
  const navigate = useNavigate();

  const variables: Variable[] = useMemo(
    () => (Array.isArray(template.variables) ? (template.variables as Variable[]) : []),
    [template.variables],
  );
  const legalBasis = Array.isArray(template.legal_basis) ? template.legal_basis : [];

  const [step, setStep] = useState<"collect" | "review" | "generating" | "done">("collect");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, string>>({});
  const [aiPolish, setAiPolish] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  // Crée la session au montage
  useEffect(() => {
    void (async () => {
      try {
        const r = await start({
          data: { template_id: template.id, dossier_id: dossierId, scenario: "no_upload", prefilled_data: {} },
        });
        setSessionId(r.session_id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur ouverture session");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missing = variables.filter((v) => v.required && !data[v.key]);

  async function handleNext() {
    if (!sessionId) return;
    if (missing.length > 0) {
      toast.error(`${missing.length} champ(s) requis manquant(s)`);
      return;
    }
    setBusy(true);
    try {
      await update({ data: { id: sessionId, collected_data: data, current_step: "review", status: "ready_to_generate" } });
      setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!sessionId) return;
    setStep("generating");
    setBusy(true);
    try {
      const r = await finalize({
        data: {
          session_id: sessionId,
          ai_polish: aiPolish,
          ai_instruction: aiInstruction || undefined,
        },
      });
      setStep("done");
      if (r.status === "pending_validation") {
        toast.success("Document généré — validation hiérarchique demandée");
      } else {
        toast.success("Document généré");
      }
      // Redirige vers la liste des documents
      setTimeout(() => {
        onClose();
        navigate({ to: "/documents" });
      }, 1200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur génération");
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="relative flex h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
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
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Stepper */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-[11px] font-medium uppercase tracking-wider">
          <span className={step === "collect" ? "text-accent" : "text-muted-foreground"}>1. Collecter</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className={step === "review" ? "text-accent" : "text-muted-foreground"}>2. Vérifier</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className={step === "generating" || step === "done" ? "text-accent" : "text-muted-foreground"}>3. Générer</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === "collect" && (
            <div className="space-y-4">
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

              <div className="grid gap-3 sm:grid-cols-2">
                {variables.map((v) => (
                  <div key={v.key} className={v.type === "textarea" ? "sm:col-span-2" : ""}>
                    <label className="mb-1 block text-[12px] font-medium">
                      {v.label}
                      {v.required && <span className="text-destructive"> *</span>}
                    </label>
                    {v.type === "textarea" ? (
                      <textarea
                        value={data[v.key] ?? ""}
                        onChange={(e) => setData({ ...data, [v.key]: e.target.value })}
                        rows={3}
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
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={v.type === "date" ? "date" : v.type === "number" ? "number" : "text"}
                        value={data[v.key] ?? ""}
                        onChange={(e) => setData({ ...data, [v.key]: e.target.value })}
                        className="input-base"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12.5px] text-amber-700 dark:text-amber-400">
                <ShieldAlert className="mr-1 inline h-4 w-4" />
                {template.risk_level === "high" || template.risk_level === "critical"
                  ? "Document à risque élevé : une demande de validation hiérarchique sera créée automatiquement."
                  : "Vérifiez les valeurs avant génération."}
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
                      L'IA conserve la structure et les valeurs factuelles, et améliore uniquement la rédaction.
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
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                ✓
              </div>
              <p className="text-[14px] font-medium">Document généré avec succès</p>
              <p className="text-[12px] text-muted-foreground">Redirection…</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === "collect" || step === "review") && (
          <footer className="flex items-center justify-between gap-3 border-t border-border p-4">
            {step === "review" ? (
              <button
                onClick={() => setStep("collect")}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:bg-secondary"
              >
                <ChevronLeft className="h-4 w-4" /> Modifier
              </button>
            ) : (
              <span className="text-[11.5px] text-muted-foreground">
                {missing.length > 0 ? `${missing.length} champ(s) requis manquant(s)` : "Tous les champs requis sont remplis"}
              </span>
            )}
            <button
              onClick={step === "collect" ? handleNext : handleGenerate}
              disabled={busy || (step === "collect" && missing.length > 0)}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:bg-accent/90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {step === "collect" ? "Continuer" : "Générer le document"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
