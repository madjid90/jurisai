import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runLegalAgent, type AgentRunOutput } from "@/server/agent.functions";
import { AppShell } from "@/components/app/AppShell";
import {
  Loader2,
  Sparkles,
  Wrench,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  Target,
  HelpCircle,
  FolderOpen,
} from "lucide-react";

const agentSearchSchema = z.object({
  q: z.string().optional(),
  dossier_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/agent")({
  head: () => ({ meta: [{ title: "Agent juridique · JurisAI" }] }),
  validateSearch: agentSearchSchema,
  component: AgentPage,
});

const INTENT_LABEL: Record<string, string> = {
  question_juridique: "Question juridique",
  redaction_document: "Rédaction de document",
  analyse_document: "Analyse de document",
  gestion_dossier: "Gestion de dossier",
  suivi_echeance: "Suivi d'échéance",
  conformite: "Conformité",
  veille: "Veille",
  recherche_jurisprudence: "Jurisprudence",
  chiffrage: "Chiffrage",
  reclamation: "Réclamation",
  autre: "Autre",
};

const DOMAIN_LABEL: Record<string, string> = {
  rh: "RH / Social",
  commercial: "Commercial",
  societes: "Sociétés",
  rgpd: "RGPD",
  fiscal: "Fiscal",
  contentieux: "Contentieux",
  administratif: "Administratif",
  reglementation_metier: "Réglementation métier",
  general: "Général",
};

function AgentPage() {
  const run = useServerFn(runLegalAgent);
  const search = Route.useSearch();
  const [message, setMessage] = useState(search.q ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentRunOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef(false);

  async function submit(text?: string) {
    const payload = (text ?? message).trim();
    if (!payload || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await run({
        data: {
          message: payload,
          dossier_id: search.dossier_id,
        },
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  // Auto-run if ?q= passed via deep-link (from dashboard)
  useEffect(() => {
    if (autoRanRef.current) return;
    if (search.q && search.q.trim()) {
      autoRanRef.current = true;
      void submit(search.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q]);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="flex items-center gap-2 text-[28px] font-bold tracking-tight">
            <Sparkles className="h-7 w-7 text-accent" />
            Agent juridique
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Comprendre → Sourcer → Proposer → Préparer → Valider → Archiver. Toutes les
            actions sensibles passent par une demande de validation.
          </p>
          {search.dossier_id && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent">
              <FolderOpen className="h-3.5 w-3.5" />
              Contexte dossier actif
              <Link
                to="/dossiers/$id"
                params={{ id: search.dossier_id }}
                className="ml-1 underline"
              >
                ouvrir
              </Link>
            </div>
          )}
        </header>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <textarea
            placeholder="Ex : Mon client veut résilier un contrat de prestation arrivant à échéance dans 2 mois — quelles règles vérifier et quel courrier préparer ?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            disabled={loading}
            className="input-base min-h-[110px] resize-y"
          />
          <div className="mt-3 flex justify-end">
            <button
              onClick={submit}
              disabled={loading || !message.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Réflexion…
                </>
              ) : (
                "Lancer l'agent"
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-[13px] text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <>
            {/* Intention détectée */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Intention détectée
              </h2>
              <div className="flex flex-wrap gap-2 text-[12px]">
                <span className="rounded-full bg-accent-soft px-3 py-1 font-medium text-accent">
                  {INTENT_LABEL[result.intent] ?? result.intent}
                </span>
                <span className="rounded-full bg-secondary px-3 py-1 font-medium text-foreground">
                  {DOMAIN_LABEL[result.domain] ?? result.domain}
                </span>
                {result.topic && (
                  <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                    {result.topic}
                  </span>
                )}
                <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                  Confiance {(result.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {result.requires_rag && (
                  <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-blue-600">
                    RAG requis
                  </span>
                )}
                {result.requires_document_upload && (
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-600">
                    Dépôt document requis
                  </span>
                )}
                {result.requires_form && (
                  <span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-purple-600">
                    Formulaire requis
                  </span>
                )}
                {result.requires_validation && (
                  <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-orange-600">
                    Validation requise
                  </span>
                )}
              </div>
            </section>

            {/* Refus motivé */}
            {result.refused && result.refusal_reason && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-700 dark:text-amber-400">
                <ShieldAlert className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-semibold">Réponse refusée</p>
                  <p className="mt-1">{result.refusal_reason}</p>
                </div>
              </div>
            )}

            {/* Réponse */}
            {result.answer && !result.refused && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Réponse
                </h2>
                <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
                  {result.answer}
                </div>
              </section>
            )}

            {/* Informations manquantes */}
            {result.missing_information.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <HelpCircle className="h-3.5 w-3.5" /> Informations à fournir
                </h2>
                <ul className="space-y-1.5 text-[13px]">
                  {result.missing_information.map((m, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Actions suggérées */}
            {result.suggested_actions.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Target className="h-3.5 w-3.5" /> Actions suggérées
                </h2>
                <ul className="space-y-2 text-[13px]">
                  {result.suggested_actions.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-border bg-background/40 p-3"
                    >
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium uppercase text-muted-foreground">
                        {a.kind}
                      </span>
                      <span className="flex-1">{a.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Outils utilisés (trace) */}
            {result.trace.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Wrench className="h-3.5 w-3.5" /> Outils exécutés ({result.trace.length})
                </h2>
                <ul className="space-y-2 text-[12.5px]">
                  {result.trace.map((t, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                    >
                      {t.succeeded ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      <code className="font-mono text-[12px]">{t.tool}</code>
                      {t.sensitive && (
                        <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-600">
                          Sensible
                        </span>
                      )}
                      {t.validation_request_id && (
                        <span className="text-[11px] text-muted-foreground">
                          → validation créée
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Sources */}
            {result.sources.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" /> Sources ({result.sources.length})
                </h2>
                <ul className="space-y-2 text-[13px]">
                  {result.sources.map((s) => (
                    <li
                      key={s.n}
                      className="border-l-2 border-accent pl-3"
                    >
                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-mono">
                        [{s.n}]
                      </span>{" "}
                      <span className="font-medium">{s.title}</span>
                      {s.ref && (
                        <span className="text-muted-foreground"> · {s.ref}</span>
                      )}
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-accent hover:underline"
                        >
                          ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="text-center text-[11px] text-muted-foreground">
              Trace conservée — voir{" "}
              <Link to="/admin/audit" className="text-accent hover:underline">
                journal d'audit
              </Link>
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
