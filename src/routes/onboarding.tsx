import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/AuthProvider";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";
import { Field } from "@/routes/login";
import { completeOnboarding } from "@/server/onboarding.functions";
import { cn } from "@/lib/utils";
import { IDCCAutocomplete } from "@/components/onboarding/IDCCAutocomplete";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Bienvenue · JurisAI" }] }),
  component: OnboardingPage,
});

const SECTORS = [
  "Services aux entreprises",
  "Conseil / Audit",
  "Bâtiment / BTP",
  "Commerce / Retail",
  "Restauration / Hôtellerie",
  "Tech / Numérique",
  "Santé",
  "Industrie",
  "Transport / Logistique",
  "Autre",
] as const;

type ProfileKind = "dirigeant" | "rh" | "juriste" | "expert_comptable" | "manager_multi_sites";

const PROFILE_KINDS: Array<{ key: ProfileKind; label: string; desc: string; emoji: string }> = [
  { key: "dirigeant", label: "Dirigeant·e", desc: "Décisions stratégiques, contrats, risques.", emoji: "👔" },
  { key: "rh", label: "RH / Paie", desc: "Embauches, contrats, procédures disciplinaires.", emoji: "👥" },
  { key: "juriste", label: "Juriste interne", desc: "Analyse de risques, contentieux, conformité.", emoji: "⚖️" },
  { key: "expert_comptable", label: "Expert-comptable", desc: "Multi-clients, paie, social.", emoji: "📊" },
  { key: "manager_multi_sites", label: "Manager multi-sites", desc: "Gestion d'équipes distribuées.", emoji: "🏢" },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const { session, profile, loading, refreshProfile } = useAuth();
  const onboard = useServerFn(completeOnboarding);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Redirects
  useEffect(() => {
    if (loading) return;
    if (!session) {
      void navigate({ to: "/login" });
    } else if (profile?.onboarded) {
      void navigate({ to: "/dashboard" });
    }
  }, [loading, session, profile, navigate]);

  // Form state
  const [profileKind, setProfileKind] = useState<ProfileKind | "">("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [siret, setSiret] = useState("");
  const [sector, setSector] = useState<string>("");
  const [idcc, setIdcc] = useState("");

  useEffect(() => {
    if (profile?.full_name && !fullName) setFullName(profile.full_name);
  }, [profile, fullName]);

  const next = () => {
    if (step === 0 && !profileKind) {
      toast.error("Choisissez votre profil");
      return;
    }
    if (step === 1 && !fullName.trim()) {
      toast.error("Renseignez votre nom");
      return;
    }
    if (step === 2 && !companyName.trim()) {
      toast.error("Renseignez le nom de votre entreprise");
      return;
    }
    setStep((s) => Math.min(s + 1, 3));
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    setSubmitting(true);
    try {
      await onboard({
        data: {
          fullName: fullName.trim(),
          jobTitle: jobTitle.trim() || null,
          phone: phone.trim() || null,
          companyName: companyName.trim(),
          siret: siret.trim() || null,
          sector: sector || null,
          idcc: idcc.trim() || null,
          profileKind: (profileKind || null) as ProfileKind | null,
        },
      });
      await refreshProfile();
      toast.success("Bienvenue sur JurisAI !");
      void navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error("Erreur", {
        description: err instanceof Error ? err.message : "Réessayez plus tard.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="mesh-bg relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex justify-center">
          <JurisAIWordmark />
        </div>

        <div className="glass-panel rounded-3xl p-8 shadow-[var(--shadow-elevated)]">
          {/* Stepper */}
          <div className="flex items-center justify-center gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold transition",
                    i < step
                      ? "bg-gradient-to-br from-primary to-accent text-primary-foreground"
                      : i === step
                        ? "bg-accent-soft text-accent ring-2 ring-accent/30"
                        : "bg-secondary text-muted-foreground",
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                {i < 2 && (
                  <div
                    className={cn(
                      "h-px w-10 transition",
                      i < step ? "bg-accent" : "bg-border",
                    )}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step content */}
          <div className="mt-8">
            {step === 0 && (
              <StepBlock title="Faisons connaissance" subtitle="Quelques infos sur vous.">
                <div className="space-y-4">
                  <Field label="Nom complet" required value={fullName} onChange={setFullName} />
                  <Field
                    label="Fonction (optionnel)"
                    value={jobTitle}
                    onChange={setJobTitle}
                    placeholder="ex. Responsable RH, Dirigeant…"
                  />
                  <Field
                    label="Téléphone (optionnel)"
                    type="tel"
                    value={phone}
                    onChange={setPhone}
                  />
                </div>
              </StepBlock>
            )}

            {step === 1 && (
              <StepBlock title="Votre entreprise" subtitle="Pour personnaliser vos réponses.">
                <div className="space-y-4">
                  <Field
                    label="Nom de l'entreprise"
                    required
                    value={companyName}
                    onChange={setCompanyName}
                  />
                  <Field
                    label="SIRET (optionnel)"
                    value={siret}
                    onChange={setSiret}
                    placeholder="14 chiffres"
                  />
                  <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/80">
                      Secteur d'activité
                    </span>
                    <select
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-4 text-[14px] text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="">— Sélectionnez —</option>
                      {SECTORS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </StepBlock>
            )}

            {step === 2 && (
              <StepBlock
                title="Convention collective"
                subtitle="Pour des réponses adaptées à votre secteur. Vous pourrez la modifier plus tard."
              >
                <div className="space-y-4">
                  <IDCCAutocomplete
                    label="Code IDCC (optionnel)"
                    value={idcc}
                    onChange={(v: string) => setIdcc(v)}
                    placeholder="Tapez un code (ex. 1486) ou un nom (ex. Syntec)…"
                  />
                  <div className="rounded-xl border border-border bg-secondary/40 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                    💡 L'IDCC (Identifiant De la Convention Collective) permet à JurisAI d'adapter
                    chaque réponse à votre convention. Vous pouvez le trouver sur vos bulletins de
                    salaire ou sur{" "}
                    <a
                      href="https://www.legifrance.gouv.fr/liste/idcc"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      legifrance.gouv.fr
                    </a>
                    .
                  </div>
                </div>
              </StepBlock>
            )}
          </div>

          {/* Actions */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={back}
              disabled={step === 0 || submitting}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-[13px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
              Précédent
            </button>

            {step < 2 ? (
              <button
                type="button"
                onClick={next}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
              >
                Suivant
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Terminer
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-[20px] font-bold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
