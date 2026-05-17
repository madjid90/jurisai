// Admin : santé des barèmes officiels + propositions en attente de validation.
//
// Affiche :
//   - Statut santé (SMIC, PSS, etc.) via checkBaremesHealth
//   - Propositions en attente (déposées par les connecteurs CDTN/INSEE/etc.)
//   - Bouton "Forcer une recherche" → triggerBaremesOrchestrator
//   - Historique des MAJ récentes

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Scale, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  getBaremesHealth,
  getPendingProposals,
  getRecentUpdates,
  validateBaremeProposal,
  rejectBaremeProposal,
  triggerBaremesOrchestrator,
} from "@/server/baremes.functions";

export const Route = createFileRoute("/_authenticated/admin/baremes")({
  head: () => ({ meta: [{ title: "Barèmes officiels · Admin · JurisAI" }] }),
  component: BaremesAdminPage,
});

type HealthCheck = {
  key: string;
  currentValue: number;
  status: "ok" | "outdated" | "missing" | "unknown";
  source?: string;
  message: string;
};

type Proposal = {
  id: string;
  table_name: string;
  new_value: Record<string, unknown>;
  source: string;
  updated_by: string;
  created_at: string;
};

type UpdateLog = {
  id: string;
  table_name: string;
  action: string;
  new_value: Record<string, unknown> | null;
  source: string | null;
  updated_by: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
};

function StatusBadge({ status }: { status: HealthCheck["status"] }) {
  if (status === "ok") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />OK</span>;
  }
  if (status === "outdated") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><AlertTriangle className="h-3 w-3" />Périmé</span>;
  }
  if (status === "missing") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><XCircle className="h-3 w-3" />Manquant</span>;
  }
  return <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">—</span>;
}

function BaremesAdminPage() {
  const [health, setHealth] = useState<HealthCheck[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [updates, setUpdates] = useState<UpdateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const getHealth = useServerFn(getBaremesHealth);
  const getProposals = useServerFn(getPendingProposals);
  const getUpdates = useServerFn(getRecentUpdates);
  const validate = useServerFn(validateBaremeProposal);
  const reject = useServerFn(rejectBaremeProposal);
  const trigger = useServerFn(triggerBaremesOrchestrator);

  async function load() {
    setLoading(true);
    try {
      const [h, p, u] = await Promise.all([getHealth(), getProposals(), getUpdates()]);
      setHealth(h as HealthCheck[]);
      setProposals(p as Proposal[]);
      setUpdates(u as UpdateLog[]);
    } catch (e) {
      toast.error("Chargement impossible : " + (e instanceof Error ? e.message : "erreur"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleTrigger() {
    setRunning(true);
    try {
      const res = await trigger() as { total_proposed: number; total_skipped: number };
      toast.success(`Orchestrateur OK : ${res.total_proposed} nouvelle(s) proposition(s), ${res.total_skipped} ignorée(s).`);
      await load();
    } catch (e) {
      toast.error("Orchestrateur : " + (e instanceof Error ? e.message : "erreur"));
    } finally {
      setRunning(false);
    }
  }

  async function handleValidate(id: string) {
    setBusy(id);
    try {
      await validate({ data: { proposalId: id } });
      toast.success("Proposition validée. Le calculateur utilise désormais la nouvelle valeur.");
      await load();
    } catch (e) {
      toast.error("Validation : " + (e instanceof Error ? e.message : "erreur"));
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(id: string) {
    setBusy(id);
    try {
      await reject({ data: { proposalId: id, reason: "Rejeté par l'admin via UI" } });
      toast.success("Proposition rejetée.");
      await load();
    } catch (e) {
      toast.error("Rejet : " + (e instanceof Error ? e.message : "erreur"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-2">
        <header className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Scale className="h-4 w-4" /> Admin
            </div>
            <h1 className="mt-1 text-2xl font-semibold">Barèmes officiels</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              SMIC, PSS, indices INSEE, taux URSSAF, barèmes fiscaux. Données récupérées chaque mois par les connecteurs et validées par l'admin avant mise en production.
            </p>
          </div>
          <Button onClick={handleTrigger} disabled={running} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Forcer une recherche
          </Button>
        </header>

        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Section : Santé des barèmes */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 text-lg font-semibold">Santé des barèmes en vigueur</h2>
              {health.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune donnée.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {health.map((h) => (
                    <li key={h.key} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{h.key}</span>
                          <StatusBadge status={h.status} />
                        </div>
                        <p className="mt-1 text-sm text-foreground/80">{h.message}</p>
                        {h.source && <p className="text-xs text-muted-foreground">Source : {h.source}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Section : Propositions en attente */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 text-lg font-semibold">
                Propositions en attente <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{proposals.length}</span>
              </h2>
              {proposals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune proposition en attente. Les connecteurs n'ont rien détecté de nouveau depuis la dernière vérification.</p>
              ) : (
                <ul className="space-y-3">
                  {proposals.map((p) => {
                    const nv = p.new_value;
                    return (
                      <li key={p.id} className="rounded-xl border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{String(nv.key ?? "?")}</span>
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {String(nv.connector ?? p.updated_by.replace("connector:", ""))}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                              {String(nv.label ?? "Nouvelle valeur")} : <span className="font-mono">{String(nv.value ?? "?")}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">À effet du {String(nv.valid_from ?? "?")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">Source : {p.source}</p>
                          </div>
                          <div className="flex flex-shrink-0 gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleReject(p.id)} disabled={busy === p.id}>
                              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Rejeter"}
                            </Button>
                            <Button size="sm" onClick={() => handleValidate(p.id)} disabled={busy === p.id}
                              className="bg-gradient-to-br from-primary to-accent text-primary-foreground">
                              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Valider"}
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Section : Historique */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Clock className="h-4 w-4" /> Historique (50 dernières actions)
              </h2>
              {updates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun historique.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {updates.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs">{u.action}</span>
                        {" • "}
                        <span className="text-xs text-muted-foreground">{u.table_name}</span>
                        {u.new_value && typeof (u.new_value as Record<string, unknown>).key === "string" && (
                          <span className="ml-2 text-xs text-foreground/80">{String((u.new_value as Record<string, unknown>).key)}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleString("fr-FR")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
