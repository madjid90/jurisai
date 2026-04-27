import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Plug, Loader2, Plus, Trash2, Copy, KeyRound, Webhook, Calendar, MessageSquare, RefreshCw, Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  getIntegrations, updateIntegrations, rotateCalendarToken,
  listApiKeys, createApiKey, revokeApiKey,
  listWebhooks, createWebhook, toggleWebhook, deleteWebhook,
  sendSlackTest,
} from "@/server/integrations.functions";

const EVENT_OPTIONS = [
  "dossier.created", "dossier.updated",
  "task.created", "task.completed",
  "comment.added", "alert.published",
] as const;

export function IntegrationsPanel() {
  const getIntFn = useServerFn(getIntegrations);
  const updateIntFn = useServerFn(updateIntegrations);
  const rotateTokenFn = useServerFn(rotateCalendarToken);
  const slackTestFn = useServerFn(sendSlackTest);

  const [loading, setLoading] = useState(true);
  const [integ, setInteg] = useState<{
    slack_channel: string | null; slack_enabled: boolean; calendar_token: string;
  } | null>(null);
  const [slackChannel, setSlackChannel] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await getIntFn();
      setInteg(data);
      setSlackChannel(data.slack_channel ?? "");
      setSlackEnabled(data.slack_enabled);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const saveSlack = async () => {
    setBusy(true);
    try {
      await updateIntFn({ data: { slack_channel: slackChannel || null, slack_enabled: slackEnabled } });
      toast.success("Préférences Slack enregistrées");
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setBusy(false); }
  };

  const testSlack = async () => {
    try { await slackTestFn(); toast.success("Message Slack envoyé !"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const rotateToken = async () => {
    if (!confirm("Régénérer le lien iCal ? L'ancien sera invalidé.")) return;
    try {
      const res = await rotateTokenFn();
      setInteg((p) => p ? { ...p, calendar_token: res.calendar_token } : p);
      toast.success("Nouveau lien iCal généré");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const calendarUrl = integ
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/calendar/${integ.calendar_token}.ics`
    : "";

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex items-center gap-2">
        <Plug className="h-4 w-4 text-accent" />
        <h2 className="text-[15px] font-semibold text-foreground">Intégrations</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
      ) : (
        <div className="space-y-6">
          {/* Slack */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-foreground/70" />
              <h3 className="text-[13.5px] font-semibold text-foreground">Slack</h3>
            </div>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Recevez les notifications de nouvelles tâches, commentaires et alertes dans un canal Slack.
              Connectez Slack via les intégrations Lovable, puis activez ci-dessous.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <input
                value={slackChannel}
                onChange={(e) => setSlackChannel(e.target.value)}
                placeholder="ID du canal (ex: C0123456789) ou #nom-du-canal"
                className="h-10 rounded-xl border border-border bg-background px-3 text-[13px]"
              />
              <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-[12.5px]">
                <input type="checkbox" checked={slackEnabled} onChange={(e) => setSlackEnabled(e.target.checked)} />
                Activé
              </label>
              <button
                onClick={saveSlack} disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
              </button>
            </div>
            {integ?.slack_enabled && integ.slack_channel && (
              <button
                onClick={testSlack}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] hover:bg-secondary"
              >
                <Send className="h-3.5 w-3.5" /> Envoyer un test
              </button>
            )}
          </section>

          {/* Calendar */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-foreground/70" />
              <h3 className="text-[13.5px] font-semibold text-foreground">Calendrier (iCal)</h3>
            </div>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Abonnez votre Google Calendar / Outlook / Apple Calendar à vos échéances et tâches.
            </p>
            <div className="flex gap-2">
              <input
                readOnly value={calendarUrl}
                className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-[12px] text-muted-foreground"
              />
              <button
                onClick={() => { navigator.clipboard.writeText(calendarUrl); toast.success("Copié"); }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] hover:bg-secondary"
              >
                <Copy className="h-3.5 w-3.5" /> Copier
              </button>
              <button
                onClick={rotateToken}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] hover:bg-secondary"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Régénérer
              </button>
            </div>
          </section>

          {/* API Keys */}
          <ApiKeysSection />

          {/* Webhooks */}
          <WebhooksSection />
        </div>
      )}
    </div>
  );
}

// ─── API KEYS ──────────────────────────────────────────────────────────────

function ApiKeysSection() {
  const listFn = useServerFn(listApiKeys);
  const createFn = useServerFn(createApiKey);
  const revokeFn = useServerFn(revokeApiKey);
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<("read" | "write")[]>(["read"]);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try { setKeys(await listFn()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      const res = await createFn({ data: { label: label.trim(), scopes } });
      setNewKey(res.key);
      setLabel(""); setScopes(["read"]); setShowForm(false);
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    if (!confirm("Révoquer cette clé ? Les appels en cours échoueront.")) return;
    try { await revokeFn({ data: { id } }); void refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-foreground/70" />
          <h3 className="text-[13.5px] font-semibold text-foreground">Clés API</h3>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent-soft"
        >
          <Plus className="h-3.5 w-3.5" /> Nouvelle clé
        </button>
      </div>

      {newKey && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-[12.5px] font-semibold text-foreground">⚠️ Copiez cette clé maintenant — elle ne sera plus affichée.</p>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-[11.5px]">{newKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(newKey); toast.success("Copié"); }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[11.5px] hover:bg-secondary"
            >
              <Copy className="h-3 w-3" /> Copier
            </button>
            <button onClick={() => setNewKey(null)} className="text-[11.5px] text-muted-foreground hover:text-foreground">×</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="mb-3 rounded-xl border border-border bg-secondary/30 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (ex: Intégration Notion)" required
              className="h-9 rounded-lg border border-border bg-background px-3 text-[13px]"
            />
            <select
              value={scopes.join(",")}
              onChange={(e) => setScopes(e.target.value.split(",") as any)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-[13px]"
            >
              <option value="read">Lecture seule</option>
              <option value="read,write">Lecture + écriture</option>
            </select>
            <button type="submit" disabled={busy} className="h-9 rounded-lg bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Créer"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
      ) : keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-[12px] text-muted-foreground">
          Aucune clé. Créez-en une pour automatiser vos workflows.
        </p>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[13px] font-semibold text-foreground">{k.label}</p>
                  {k.revoked_at && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">Révoquée</span>}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{k.prefix}••••••</p>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                  Créée le {new Date(k.created_at).toLocaleDateString("fr-FR")}
                  {k.last_used_at && ` · utilisée ${new Date(k.last_used_at).toLocaleDateString("fr-FR")}`}
                  {" · "}{(k.scopes as string[]).join(" + ")}
                </p>
              </div>
              {!k.revoked_at && (
                <button onClick={() => revoke(k.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── WEBHOOKS ──────────────────────────────────────────────────────────────

function WebhooksSection() {
  const listFn = useServerFn(listWebhooks);
  const createFn = useServerFn(createWebhook);
  const toggleFn = useServerFn(toggleWebhook);
  const delFn = useServerFn(deleteWebhook);

  const [hooks, setHooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try { setHooks(await listFn()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url || events.length === 0) return;
    setBusy(true);
    try {
      const res = await createFn({ data: { target_url: url, events: events as any } });
      setNewSecret(res.secret);
      setUrl(""); setEvents([]); setShowForm(false);
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };

  const toggle = async (id: string, active: boolean) => {
    try { await toggleFn({ data: { id, active } }); void refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce webhook ?")) return;
    try { await delFn({ data: { id } }); void refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-foreground/70" />
          <h3 className="text-[13.5px] font-semibold text-foreground">Webhooks sortants</h3>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent-soft"
        >
          <Plus className="h-3.5 w-3.5" /> Nouveau
        </button>
      </div>

      {newSecret && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-[12.5px] font-semibold text-foreground">⚠️ Secret du webhook (header X-JurisAI-Signature). Conservez-le maintenant.</p>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-[11.5px]">{newSecret}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(newSecret); toast.success("Copié"); }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[11.5px] hover:bg-secondary"
            >
              <Copy className="h-3 w-3" /> Copier
            </button>
            <button onClick={() => setNewSecret(null)} className="text-[11.5px] text-muted-foreground hover:text-foreground">×</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="mb-3 space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
          <input
            value={url} onChange={(e) => setUrl(e.target.value)}
            type="url" required placeholder="https://votre-app.com/webhooks/jurisai"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px]"
          />
          <div className="flex flex-wrap gap-1.5">
            {EVENT_OPTIONS.map((ev) => (
              <label key={ev} className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] ${events.includes(ev) ? "border-accent bg-accent-soft text-accent-soft-foreground" : "border-border"}`}>
                <input
                  type="checkbox" className="hidden"
                  checked={events.includes(ev)}
                  onChange={(e) => setEvents((p) => e.target.checked ? [...p, ev] : p.filter((x) => x !== ev))}
                />
                {ev}
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !url || events.length === 0} className="h-9 rounded-lg bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Créer"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
      ) : hooks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-[12px] text-muted-foreground">
          Aucun webhook configuré.
        </p>
      ) : (
        <ul className="space-y-2">
          {hooks.map((h) => (
            <li key={h.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[12px] text-foreground">{h.target_url}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{(h.events as string[]).join(", ")}</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <input type="checkbox" checked={h.active} onChange={(e) => toggle(h.id, e.target.checked)} />
                {h.active ? "Actif" : "Inactif"}
              </label>
              <button onClick={() => remove(h.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
