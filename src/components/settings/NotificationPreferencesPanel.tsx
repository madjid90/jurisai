import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/server/notifications.functions";

type Prefs = {
  email_enabled: boolean;
  app_enabled: boolean;
  digest_frequency: "realtime" | "daily" | "weekly" | "never";
  watched_domains: string[];
  watched_update_types: string[];
  watched_site_ids: string[];
  watched_client_ids: string[];
  notify_on: Record<string, boolean>;
};

const NOTIFY_KIND_LABELS: Record<string, string> = {
  rappel_retard: "Rappels de retard",
  action_requise: "Action requise",
  risque_detecte: "Risque détecté",
  echeance_proche: "Échéance proche",
  workflow_bloque: "Workflow bloqué",
  document_a_valider: "Document à valider",
  rapport_disponible: "Rapport disponible",
  nouvelle_mise_a_jour_juridique: "Nouvelle mise à jour juridique",
};

const DOMAINS = ["rgpd", "social", "commercial", "fiscal", "societes", "contentieux"];

export function NotificationPreferencesPanel() {
  const getFn = useServerFn(getNotificationPreferences);
  const updateFn = useServerFn(updateNotificationPreferences);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = (await getFn()) as Prefs;
        setPrefs(data);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await updateFn({
        data: {
          email_enabled: prefs.email_enabled,
          app_enabled: prefs.app_enabled,
          digest_frequency: prefs.digest_frequency,
          watched_domains: prefs.watched_domains,
          watched_update_types: prefs.watched_update_types,
          watched_site_ids: prefs.watched_site_ids,
          watched_client_ids: prefs.watched_client_ids,
          notify_on: prefs.notify_on,
        },
      });
      toast.success("Préférences enregistrées");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
      </div>
    );
  }
  if (!prefs) return null;

  const toggleDomain = (d: string) => {
    setPrefs({
      ...prefs,
      watched_domains: prefs.watched_domains.includes(d)
        ? prefs.watched_domains.filter((x) => x !== d)
        : [...prefs.watched_domains, d],
    });
  };

  const toggleKind = (k: string, v: boolean) => {
    setPrefs({ ...prefs, notify_on: { ...prefs.notify_on, [k]: v } });
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex items-center gap-2">
        <Bell className="h-4 w-4 text-accent" />
        <h2 className="text-[15px] font-semibold text-foreground">Notifications</h2>
      </div>

      <div className="space-y-6">
        {/* Canaux */}
        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Canaux</p>
          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm">Notifications dans l'application</span>
            <input
              type="checkbox"
              checked={prefs.app_enabled}
              onChange={(e) => setPrefs({ ...prefs, app_enabled: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
          <label className="mt-2 flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm">Notifications par email</span>
            <input
              type="checkbox"
              checked={prefs.email_enabled}
              onChange={(e) => setPrefs({ ...prefs, email_enabled: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
        </section>

        {/* Fréquence */}
        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Fréquence email</p>
          <select
            className="input-base"
            value={prefs.digest_frequency}
            onChange={(e) =>
              setPrefs({ ...prefs, digest_frequency: e.target.value as Prefs["digest_frequency"] })
            }
          >
            <option value="realtime">Temps réel (chaque événement)</option>
            <option value="daily">Résumé quotidien</option>
            <option value="weekly">Résumé hebdomadaire</option>
            <option value="never">Jamais</option>
          </select>
        </section>

        {/* Domaines suivis */}
        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Domaines juridiques suivis
          </p>
          <div className="flex flex-wrap gap-2">
            {DOMAINS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDomain(d)}
                className={`rounded-full border px-3 py-1 text-xs capitalize transition ${
                  prefs.watched_domains.includes(d)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-secondary"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Si aucun domaine n'est sélectionné, vous recevez tout.
          </p>
        </section>

        {/* Types d'événements */}
        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Types d'événements
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(NOTIFY_KIND_LABELS).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <span className="text-[13px]">{label}</span>
                <input
                  type="checkbox"
                  checked={prefs.notify_on[k] !== false}
                  onChange={(e) => toggleKind(k, e.target.checked)}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
