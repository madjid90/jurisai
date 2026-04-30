import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Database,
  FileText,
  Lightbulb,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Trash2,
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
  title: string;
  description: string;
  legal_basis?: Array<{ label: string; reference?: string }>;
  mitigation?: string;
};

type Analysis = {
  domain?: string;
  document_type: string;
  summary: string;
  key_points: string[];
  risks: Risk[];
  compliance: Array<{ status: "ok" | "warning" | "issue"; title: string; description: string }>;
  recommendations: string[];
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
            {/* Résumé */}
            <Section title="Résumé" icon={FileText}>
              <p className="text-[14px] leading-relaxed text-foreground">{a.summary}</p>
            </Section>

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

function RiskCard({
  risk,
}: {
  risk: { severity: "low" | "medium" | "high"; title: string; description: string };
}) {
  const config = {
    low: { color: "border-border bg-secondary/40", badge: "bg-secondary text-muted-foreground", label: "Faible" },
    medium: { color: "border-amber-500/30 bg-amber-500/5", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Moyen" },
    high: { color: "border-destructive/40 bg-destructive/5", badge: "bg-destructive/15 text-destructive", label: "Élevé" },
  }[risk.severity];

  return (
    <div className={cn("rounded-xl border p-3", config.color)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13.5px] font-semibold text-foreground">{risk.title}</p>
        <span className={cn("rounded-md px-2 py-0.5 text-[10.5px] font-semibold", config.badge)}>
          {config.label}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">{risk.description}</p>
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
