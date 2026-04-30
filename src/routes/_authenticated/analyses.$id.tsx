import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Database,
  FileText,
  Lightbulb,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { cn } from "@/lib/utils";
import { deleteAnalysis, getAnalysis, validateExtractedField } from "@/server/analysis.functions";

export const Route = createFileRoute("/_authenticated/analyses/$id")({
  head: () => ({ meta: [{ title: "Analyse · JurisAI" }] }),
  component: AnalysisDetailPage,
});

const DOMAIN_LABELS: Record<string, string> = {
  rh: "Ressources humaines",
  commercial: "Commercial",
  societes: "Droit des sociétés",
  rgpd: "RGPD / Données personnelles",
  fiscal: "Fiscal",
  contentieux: "Contentieux",
  administratif: "Administratif",
  autre: "Autre",
};

type Risk = {
  severity: "low" | "medium" | "high" | "critical";
  category?: string;
  risk_key?: string | null;
  title: string;
  description: string;
  legal_basis?: Array<{ label: string; reference?: string }>;
  mitigation?: string;
};

type ContractParty = { role?: string; name?: string; legal_form?: string; siret?: string };
type ContractData = {
  parties?: ContractParty[];
  object?: string;
  signature_date?: string;
  effective_date?: string;
  end_date?: string;
  duration?: string;
  renewal?: { type?: string; notice_days?: number; notice_deadline?: string };
  notice_period?: string;
  amount?: string;
  payment_terms?: string;
  penalties?: string;
  termination?: string;
  jurisdiction?: string;
  governing_law?: string;
  confidentiality?: boolean;
  non_compete?: { present?: boolean; duration?: string; zone?: string; compensation?: string };
};

type DetectedDateUI = {
  key: string;
  label: string;
  iso_date: string;
  type: string;
  importance: "low" | "medium" | "high" | "critical";
  description?: string;
};

type Analysis = {
  domain?: string;
  document_type: string;
  summary: string;
  key_points: string[];
  risks: Risk[];
  compliance: Array<{ status: "ok" | "warning" | "issue"; title: string; description: string }>;
  recommendations: string[];
  contract_data?: ContractData;
  detected_dates?: DetectedDateUI[];
};

type ExtractedField = {
  id: string;
  field_key: string;
  field_value: string | null;
  field_type: string;
  confidence: number | null;
  source_excerpt: string | null;
  validated_by_user: boolean;
};

type Row = {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: string;
  analysis: Analysis | null;
  contract_data?: ContractData | null;
  detected_dates?: DetectedDateUI[] | null;
  error_message: string | null;
  created_at: string;
  extracted_text: string | null;
  dossier_id: string | null;
};

function AnalysisDetailPage() {
  const confirmAsync = useConfirm();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getAnalysis);
  const deleteFn = useServerFn(deleteAnalysis);
  const validateFieldFn = useServerFn(validateExtractedField);

  const [row, setRow] = useState<Row | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await getFn({ data: { id } });
        setRow(res.analysis as Row);
        setFields((res.extracted_fields ?? []) as ExtractedField[]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur");
        void navigate({ to: "/analyses" });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleValidateField = async (fieldId: string, validated: boolean) => {
    try {
      await validateFieldFn({ data: { id: fieldId, validated } });
      setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, validated_by_user: validated } : f)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleDelete = async () => {
    if (!(await confirmAsync("Supprimer cette analyse ?"))) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Supprimée");
      void navigate({ to: "/analyses" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="glass-panel flex flex-1 items-center justify-center rounded-3xl">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      </AppShell>
    );
  }

  if (!row) return null;

  const a = row.analysis;

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl shadow-[var(--shadow-card)]">
        {/* Header */}
        <div className="border-b border-border px-8 py-5">
          <Link
            to="/analyses"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour aux analyses
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-[20px] font-bold text-foreground">{row.filename}</h1>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {a?.document_type ?? "—"} · {(row.file_size / 1024).toFixed(0)} KB ·{" "}
                  {new Date(row.created_at).toLocaleDateString("fr-FR")}
                </p>
              </div>
            </div>
            <button
              onClick={handleDelete}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-destructive/30 px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer
            </button>
          </div>
        </div>

        {row.status !== "completed" || !a ? (
          <div className="px-8 py-10 text-center">
            <p className="text-[14px] text-muted-foreground">
              {row.error_message ?? "Analyse non disponible."}
            </p>
          </div>
        ) : (
          <div className="space-y-6 px-8 py-6">
            {/* Domaine + type */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-accent">
                {DOMAIN_LABELS[a.domain ?? "autre"] ?? a.domain ?? "Autre"}
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 text-[11.5px] font-medium text-muted-foreground">
                {a.document_type}
              </span>
              {row.dossier_id && (
                <Link
                  to="/dossiers/$id"
                  params={{ id: row.dossier_id }}
                  className="rounded-full border border-border px-3 py-1 text-[11.5px] font-medium text-accent hover:bg-accent/5"
                >
                  → Voir le dossier rattaché
                </Link>
              )}
            </div>

            {/* Résumé */}
            <Section title="Résumé" icon={FileText}>
              <p className="text-[14px] leading-relaxed text-foreground">{a.summary}</p>
            </Section>

            {/* Champs extraits */}
            {fields.length > 0 && (
              <Section title={`Champs extraits (${fields.length})`} icon={Database}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map((f) => (
                    <div
                      key={f.id}
                      className={cn(
                        "rounded-xl border p-2.5",
                        f.validated_by_user
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                            {f.field_key}
                            {typeof f.confidence === "number" && (
                              <span className="ml-1 text-[10px] text-muted-foreground/70">
                                · {Math.round(f.confidence * 100)}%
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 break-words text-[12.5px] font-medium text-foreground">
                            {f.field_value || <em className="text-amber-600">(vide)</em>}
                          </p>
                          {f.source_excerpt && (
                            <p className="mt-1 line-clamp-2 text-[10.5px] italic text-muted-foreground">
                              « {f.source_excerpt} »
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleValidateField(f.id, !f.validated_by_user)}
                          className={cn(
                            "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border",
                            f.validated_by_user
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-border text-muted-foreground hover:border-accent hover:text-accent",
                          )}
                          title={f.validated_by_user ? "Champ validé" : "Valider ce champ"}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Données contractuelles */}
            {((row.contract_data && Object.keys(row.contract_data).length > 0) || a.contract_data) && (() => {
              const cd = (row.contract_data ?? a.contract_data ?? {}) as ContractData;
              const hasAny = !!(cd.parties?.length || cd.object || cd.signature_date || cd.effective_date || cd.end_date || cd.duration || cd.amount || cd.jurisdiction);
              if (!hasAny) return null;
              return (
                <Section title="Données contractuelles" icon={Users}>
                  <div className="space-y-3">
                    {cd.parties && cd.parties.length > 0 && (
                      <div>
                        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Parties</div>
                        <ul className="space-y-1">
                          {cd.parties.map((p, i) => (
                            <li key={i} className="text-[12.5px]">
                              <span className="font-medium">{p.name ?? "—"}</span>
                              {p.legal_form && <span className="text-muted-foreground"> · {p.legal_form}</span>}
                              {p.role && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px]">{p.role}</span>}
                              {p.siret && <span className="ml-2 text-[10.5px] text-muted-foreground">SIRET {p.siret}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {cd.object && <Field label="Objet" value={cd.object} />}
                      {cd.signature_date && <Field label="Date de signature" value={cd.signature_date} />}
                      {cd.effective_date && <Field label="Prise d'effet" value={cd.effective_date} />}
                      {cd.end_date && <Field label="Fin" value={cd.end_date} />}
                      {cd.duration && <Field label="Durée" value={cd.duration} />}
                      {cd.notice_period && <Field label="Préavis" value={cd.notice_period} />}
                      {cd.renewal?.type && <Field label="Renouvellement" value={`${cd.renewal.type}${cd.renewal.notice_days ? ` · ${cd.renewal.notice_days}j` : ""}`} />}
                      {cd.amount && <Field label="Montant" value={cd.amount} />}
                      {cd.payment_terms && <Field label="Conditions de paiement" value={cd.payment_terms} />}
                      {cd.penalties && <Field label="Pénalités" value={cd.penalties} />}
                      {cd.termination && <Field label="Résiliation" value={cd.termination} />}
                      {cd.jurisdiction && <Field label="Juridiction" value={cd.jurisdiction} />}
                      {cd.governing_law && <Field label="Loi applicable" value={cd.governing_law} />}
                      {cd.confidentiality !== undefined && <Field label="Confidentialité" value={cd.confidentiality ? "Oui" : "Non"} />}
                    </div>
                    {cd.non_compete?.present && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px]">
                        <div className="font-semibold">Clause de non-concurrence</div>
                        <div className="text-muted-foreground">
                          {cd.non_compete.duration ?? "—"} · {cd.non_compete.zone ?? "—"} · {cd.non_compete.compensation ?? "sans contrepartie"}
                        </div>
                      </div>
                    )}
                  </div>
                </Section>
              );
            })()}

            {/* Échéances détectées */}
            {(() => {
              const dates = (row.detected_dates ?? a.detected_dates ?? []) as DetectedDateUI[];
              if (!dates.length) return null;
              return (
                <Section title={`Échéances détectées (${dates.length})`} icon={Calendar}>
                  <ul className="space-y-2">
                    {dates.map((d, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 text-[12.5px]">
                        <div>
                          <div className="font-medium">{d.label}</div>
                          {d.description && <div className="text-[11.5px] text-muted-foreground">{d.description}</div>}
                          <div className="mt-1 text-[10.5px] text-muted-foreground">{d.type}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono text-[12px]">{d.iso_date}</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                            d.importance === "critical" && "bg-destructive/15 text-destructive",
                            d.importance === "high" && "bg-orange-500/15 text-orange-600",
                            d.importance === "medium" && "bg-amber-500/15 text-amber-600",
                            d.importance === "low" && "bg-secondary text-muted-foreground",
                          )}>{d.importance}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {row.dossier_id && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      ✓ Échéances importantes ajoutées automatiquement au calendrier du dossier.
                    </p>
                  )}
                </Section>
              );
            })()}

            {/* Points clés */}
            {a.key_points?.length > 0 && (
              <Section title="Points clés" icon={CheckCircle2}>
                <ul className="space-y-2">
                  {a.key_points.map((p, i) => (
                    <li key={i} className="flex gap-3 text-[13.5px] text-foreground">
                      <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Risques */}
            {a.risks?.length > 0 && (
              <Section title={`Points de vigilance (${a.risks.length})`} icon={AlertTriangle}>
                <div className="space-y-2">
                  {a.risks.map((r, i) => (
                    <RiskCard key={i} risk={r} />
                  ))}
                </div>
              </Section>
            )}

            {/* Conformité */}
            {a.compliance?.length > 0 && (
              <Section title="Conformité" icon={ShieldCheck}>
                <div className="space-y-2">
                  {a.compliance.map((c, i) => (
                    <ComplianceCard key={i} item={c} />
                  ))}
                </div>
              </Section>
            )}

            {/* Recommandations */}
            {a.recommendations?.length > 0 && (
              <Section title="Recommandations" icon={Lightbulb}>
                <ol className="space-y-2">
                  {a.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-3 text-[13.5px] text-foreground">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10.5px] font-bold text-accent-soft-foreground">
                        {i + 1}
                      </span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {/* Texte brut */}
            {row.extracted_text && (
              <div>
                <button
                  onClick={() => setShowText((s) => !s)}
                  className="text-[12px] font-medium text-accent hover:underline"
                >
                  {showText ? "Masquer" : "Voir"} le texte extrait
                </button>
                {showText && (
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-4 text-[11.5px] font-mono text-foreground">
                    {row.extracted_text}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <h2 className="text-[12.5px] font-semibold uppercase tracking-wide text-foreground">
          {title}
        </h2>
      </div>
      <div className="rounded-2xl border border-border/60 bg-card p-5">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[12.5px]">
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function RiskCard({ risk }: { risk: Risk }) {
  const config = {
    low: { color: "border-border bg-secondary/40", badge: "bg-secondary text-muted-foreground", label: "Faible" },
    medium: { color: "border-amber-500/30 bg-amber-500/5", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Moyen" },
    high: { color: "border-destructive/40 bg-destructive/5", badge: "bg-destructive/15 text-destructive", label: "Élevé" },
    critical: { color: "border-destructive bg-destructive/10", badge: "bg-destructive text-destructive-foreground", label: "Critique" },
  }[risk.severity];

  return (
    <div className={cn("rounded-xl border p-3", config.color)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13.5px] font-semibold text-foreground">
          {risk.title}
          {risk.category && (
            <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal uppercase text-muted-foreground">
              {risk.category}
            </span>
          )}
        </p>
        <span className={cn("rounded-md px-2 py-0.5 text-[10.5px] font-semibold", config.badge)}>
          {config.label}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">{risk.description}</p>
      {risk.mitigation && (
        <p className="mt-2 text-[12px] text-foreground/80">
          <strong>Action :</strong> {risk.mitigation}
        </p>
      )}
      {risk.legal_basis && risk.legal_basis.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {risk.legal_basis.map((lb, i) => (
            <li key={i} className="rounded-md bg-background px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
              📚 {lb.label}{lb.reference ? ` (${lb.reference})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ComplianceCard({
  item,
}: {
  item: { status: "ok" | "warning" | "issue"; title: string; description: string };
}) {
  const config = {
    ok: { Icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400" },
    warning: { Icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400" },
    issue: { Icon: ShieldAlert, color: "text-destructive" },
  }[item.status];

  return (
    <div className="flex gap-3 rounded-xl border border-border/60 bg-secondary/30 p-3">
      <config.Icon className={cn("h-4 w-4 flex-shrink-0", config.color)} />
      <div>
        <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{item.description}</p>
      </div>
    </div>
  );
}
