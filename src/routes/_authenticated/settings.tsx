import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Settings,
  Building2,
  User as UserIcon,
  Loader2,
  Save,
  Download,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { IntegrationsPanel } from "@/components/settings/IntegrationsPanel";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { updateProfile, updateTenant } from "@/server/settings.functions";
import { exportMyData, deleteMyAccount } from "@/server/rgpd.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Paramètres · JurisAI" }] }),
  component: SettingsPage,
});

type Tenant = {
  id: string;
  name: string;
  siret: string | null;
  sector: string | null;
  idcc: string | null;
  plan: string;
};

function SettingsPage() {
  const { profile, user, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const updateProfileFn = useServerFn(updateProfile);
  const updateTenantFn = useServerFn(updateTenant);
  const exportDataFn = useServerFn(exportMyData);
  const deleteAccountFn = useServerFn(deleteMyAccount);

  // Profile form
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [jobTitle, setJobTitle] = useState(profile?.job_title ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Tenant
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [siret, setSiret] = useState("");
  const [sector, setSector] = useState("");
  const [idcc, setIdcc] = useState("");
  const [savingTenant, setSavingTenant] = useState(false);

  // RGPD
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      const data = await exportDataFn({});
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jurisai-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Vos données ont été exportées");
    } catch (err) {
      toast.error("Export impossible", {
        description: err instanceof Error ? err.message : "Erreur",
      });
    } finally {
      setExporting(false);
    }
  };

  const onDelete = async () => {
    if (deleteConfirm !== "SUPPRIMER") {
      toast.error("Confirmation incorrecte", {
        description: 'Tapez "SUPPRIMER" pour confirmer.',
      });
      return;
    }
    setDeleting(true);
    try {
      await deleteAccountFn({ data: { confirmation: "SUPPRIMER" as const } });
      toast.success("Compte supprimé");
      await signOut();
      void navigate({ to: "/" });
    } catch (err) {
      toast.error("Suppression impossible", {
        description: err instanceof Error ? err.message : "Erreur",
      });
      setDeleting(false);
    }
  };
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setJobTitle(profile?.job_title ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile]);

  useEffect(() => {
    if (!profile?.tenant_id || !user) return;
    void (async () => {
      const { data: t } = await supabase
        .from("tenants")
        .select("id, name, siret, sector, idcc, plan")
        .eq("id", profile.tenant_id!)
        .maybeSingle();
      const tt = t as Tenant | null;
      if (tt) {
        setTenant(tt);
        setTenantName(tt.name);
        setSiret(tt.siret ?? "");
        setSector(tt.sector ?? "");
        setIdcc(tt.idcc ?? "");
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("tenant_id", profile.tenant_id!);
      setIsAdmin(((roles as Array<{ role: string }>) ?? []).some((r) => r.role === "admin"));
    })();
  }, [profile?.tenant_id, user]);

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfileFn({
        data: {
          fullName,
          jobTitle: jobTitle || null,
          phone: phone || null,
        },
      });
      await refreshProfile();
      toast.success("Profil mis à jour");
    } catch (err) {
      toast.error("Échec", {
        description: err instanceof Error ? err.message : "Erreur",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const onSaveTenant = async (e: FormEvent) => {
    e.preventDefault();
    setSavingTenant(true);
    try {
      await updateTenantFn({
        data: {
          name: tenantName,
          siret: siret || null,
          sector: sector || null,
          idcc: idcc || null,
        },
      });
      toast.success("Organisation mise à jour");
      // refresh tenant local state
      setTenant((prev) =>
        prev ? { ...prev, name: tenantName, siret, sector, idcc } : prev,
      );
    } catch (err) {
      toast.error("Échec", {
        description: err instanceof Error ? err.message : "Erreur",
      });
    } finally {
      setSavingTenant(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-3 overflow-y-auto pb-6">
        {/* Header */}
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
              <Settings className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-[26px] font-bold tracking-tight text-foreground">Paramètres</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Gérez votre profil et les informations de votre organisation.
              </p>
            </div>
          </div>
        </div>

        {/* Profile */}
        <form
          onSubmit={onSaveProfile}
          className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"
        >
          <div className="mb-5 flex items-center gap-2">
            <UserIcon className="h-4 w-4 text-accent" />
            <h2 className="text-[15px] font-semibold text-foreground">Mon profil</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SettingsField
              label="Nom complet"
              value={fullName}
              onChange={setFullName}
              required
            />
            <SettingsField
              label="Email"
              value={user?.email ?? ""}
              onChange={() => undefined}
              disabled
              hint="Géré par votre compte"
            />
            <SettingsField
              label="Fonction"
              value={jobTitle}
              onChange={setJobTitle}
              placeholder="DRH, Juriste, Avocat…"
            />
            <SettingsField
              label="Téléphone"
              value={phone}
              onChange={setPhone}
              placeholder="+33 6 12 34 56 78"
            />
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 text-[13.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
            >
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Enregistrer
            </button>
          </div>
        </form>

        {/* Tenant */}
        {tenant && (
          <form
            onSubmit={onSaveTenant}
            className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-accent" />
                <h2 className="text-[15px] font-semibold text-foreground">Organisation</h2>
              </div>
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold capitalize text-accent">
                Plan {tenant.plan}
              </span>
            </div>

            {!isAdmin && (
              <p className="mb-4 rounded-xl border border-border bg-secondary px-4 py-2.5 text-[12.5px] text-muted-foreground">
                Seul un administrateur peut modifier ces informations.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsField
                label="Nom de l'entreprise"
                value={tenantName}
                onChange={setTenantName}
                required
                disabled={!isAdmin}
              />
              <SettingsField
                label="SIRET"
                value={siret}
                onChange={setSiret}
                placeholder="14 chiffres"
                disabled={!isAdmin}
              />
              <SettingsField
                label="Secteur d'activité"
                value={sector}
                onChange={setSector}
                placeholder="Conseil, Industrie, BTP…"
                disabled={!isAdmin}
              />
              <SettingsField
                label="Code IDCC"
                value={idcc}
                onChange={setIdcc}
                placeholder="ex: 1486 (Syntec)"
                hint="Convention collective applicable"
                disabled={!isAdmin}
              />
            </div>

            {isAdmin && (
              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  disabled={savingTenant}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 text-[13.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
                >
                  {savingTenant ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Enregistrer
                </button>
              </div>
            )}
          </form>
        )}

        {/* Intégrations (admins seulement) */}
        {isAdmin && <IntegrationsPanel />}

        {/* RGPD — Mes données */}
        <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <div className="mb-5 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-accent" />
            <h2 className="text-[15px] font-semibold text-foreground">
              Mes données personnelles (RGPD)
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-secondary/40 p-4">
              <p className="text-[13.5px] font-semibold text-foreground">
                Exporter mes données
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Téléchargez l'intégralité de vos données au format JSON
                (profil, conversations, documents).
              </p>
              <button
                type="button"
                onClick={onExport}
                disabled={exporting}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-[12.5px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Télécharger l'export
              </button>
            </div>

            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-[13.5px] font-semibold text-foreground">
                Supprimer mon compte
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Suppression définitive du compte et de toutes les données
                associées. Action irréversible.
              </p>
              {!showDelete ? (
                <button
                  type="button"
                  onClick={() => setShowDelete(true)}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-destructive/50 bg-background px-3 text-[12.5px] font-semibold text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer mon compte
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder='Tapez "SUPPRIMER"'
                    className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive/20"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={deleting || deleteConfirm !== "SUPPRIMER"}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-destructive px-3 text-[12.5px] font-semibold text-destructive-foreground transition hover:opacity-95 disabled:opacity-60"
                    >
                      {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDelete(false);
                        setDeleteConfirm("");
                      }}
                      disabled={deleting}
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-[12.5px] font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsField({
  label,
  value,
  onChange,
  placeholder,
  required,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-foreground">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="h-10 rounded-xl border border-border bg-background px-3 text-[13.5px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
