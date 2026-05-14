import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { DossierCollab } from "@/components/app/DossierCollab";
import { Dossier360Tabs } from "@/components/app/Dossier360Tabs";
import { cn } from "@/lib/utils";
import {
  createDeadline,
  deleteDeadline,
  deleteDossier,
  getDossier,
  updateDeadline,
  updateDossier,
} from "@/lib/server-fns/crm.functions";
import { exportDossierPDF } from "@/lib/server-fns/exports.functions";

export const Route = createFileRoute("/_authenticated/dossiers/$id")({
  head: () => ({ meta: [{ title: "Dossier · JurisAI" }] }),
  component: DossierDetailPage,
});

import {
  CASE_STATUS_OPTIONS,
  CASE_TYPE_OPTIONS,
  STATUS_TONE_CLASS,
  getCaseStatusMeta,
  getCaseTypeMeta,
} from "@/lib/dossiers/case-meta";

type Dossier = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  risk_level: "low" | "medium" | "high";
  client_id: string | null;
  client?: { id: string; full_name: string; job_title: string | null } | null;
  created_at: string;
  updated_at: string;
};

type Deadline = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  completed: boolean;
};

const RISK_LABEL = { low: "Faible", medium: "Moyen", high: "Élevé" };

function DossierDetailPage() {
  const confirmAsync = useConfirm();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getDossier);
  const updateFn = useServerFn(updateDossier);
  const deleteFn = useServerFn(deleteDossier);
  const createDeadlineFn = useServerFn(createDeadline);
  const updateDeadlineFn = useServerFn(updateDeadline);
  const deleteDeadlineFn = useServerFn(deleteDeadline);
  const exportFn = useServerFn(exportDossierPDF);

  const [loading, setLoading] = useState(true);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [showDeadlineForm, setShowDeadlineForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const res = await exportFn({ data: { dossierId: id } });
      // Convert base64 → Blob → trigger browser download
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("PDF généré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur export");
    } finally {
      setExporting(false);
    }
  };
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "autre",
    status: "open" as Dossier["status"],
    risk_level: "low" as Dossier["risk_level"],
  });

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await getFn({ data: { id } });
      const d = res.dossier as Dossier;
      setDossier(d);
      setDeadlines((res.deadlines ?? []) as Deadline[]);
      setForm({
        title: d.title,
        description: d.description ?? "",
        category: d.category,
        status: d.status,
        risk_level: d.risk_level,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      void navigate({ to: "/dossiers" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async () => {
    try {
      await updateFn({ data: { id, ...form } });
      toast.success("Dossier mis à jour");
      setEditing(false);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleDelete = async () => {
    if (!(await confirmAsync("Supprimer ce dossier et toutes ses échéances ?"))) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Dossier supprimé");
      void navigate({ to: "/dossiers" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleToggleDeadline = async (d: Deadline) => {
    try {
      await updateDeadlineFn({ data: { id: d.id, completed: !d.completed } });
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleDeleteDeadline = async (deadlineId: string) => {
    try {
      await deleteDeadlineFn({ data: { id: deadlineId } });
      void refresh();
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

  if (!dossier) return null;

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-8 py-5">
          <Link to="/dossiers" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour aux dossiers
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {editing ? (
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[20px] font-bold text-foreground"
                />
              ) : (
                <h1 className="truncate text-[22px] font-bold text-foreground">{dossier.title}</h1>
              )}
              <p className="mt-1 text-[13px] text-muted-foreground">
                {dossier.client?.full_name ?? "Sans client"}
                {dossier.client?.job_title && ` · ${dossier.client.job_title}`}
              </p>
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={() => {
                      setEditing(false);
                      void refresh();
                    }}
                    className="h-9 rounded-xl border border-border px-3 text-[12.5px] hover:bg-secondary"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSave}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground"
                  >
                    <Save className="h-3.5 w-3.5" /> Enregistrer
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditing(true)}
                    className="h-9 rounded-xl border border-border px-3 text-[12.5px] font-medium hover:bg-secondary"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={handleExportPDF}
                    disabled={exporting}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] font-medium hover:bg-secondary disabled:opacity-50"
                  >
                    {exporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Exporter PDF
                  </button>
                  <button
                    onClick={handleDelete}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-destructive/30 px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
          {/* Left: meta + description */}
          <div className="space-y-4 lg:col-span-2">
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
              {editing ? (
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={6}
                  className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-[13.5px] outline-none focus:border-accent"
                />
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-foreground">
                  {dossier.description || <span className="text-muted-foreground">Aucune description.</span>}
                </p>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Échéances ({deadlines.length})
                </h3>
                <button
                  onClick={() => setShowDeadlineForm(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[12px] font-medium text-foreground hover:bg-accent-soft"
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </button>
              </div>
              {deadlines.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                  Aucune échéance. Ajoutez-en pour suivre les étapes clés.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {deadlines.map((d) => {
                    const due = new Date(d.due_date);
                    const overdue = !d.completed && due < new Date();
                    return (
                      <div
                        key={d.id}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border bg-card p-3",
                          overdue ? "border-destructive/40" : "border-border/60",
                          d.completed && "opacity-60",
                        )}
                      >
                        <button
                          onClick={() => handleToggleDeadline(d)}
                          className={cn(
                            "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition",
                            d.completed
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-border hover:border-accent",
                          )}
                        >
                          {d.completed && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-[13px] font-semibold text-foreground", d.completed && "line-through")}>
                            {d.title}
                          </p>
                          {d.description && (
                            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{d.description}</p>
                          )}
                        </div>
                        <span className={cn("text-[11.5px]", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {due.toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <button
                          onClick={() => handleDeleteDeadline(d.id)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <DossierCollab dossierId={id} />
          </div>

          {/* Right: meta */}
          <aside className="space-y-3">
            <MetaItem label="Statut">
              {editing ? (
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12.5px]"
                >
                  {CASE_STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] font-medium",
                    STATUS_TONE_CLASS[getCaseStatusMeta(dossier.status).tone],
                  )}
                >
                  {getCaseStatusMeta(dossier.status).label}
                </span>
              )}
            </MetaItem>
            <MetaItem label="Risque">
              {editing ? (
                <select
                  value={form.risk_level}
                  onChange={(e) => setForm({ ...form, risk_level: e.target.value as Dossier["risk_level"] })}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12.5px]"
                >
                  <option value="low">Faible</option>
                  <option value="medium">Moyen</option>
                  <option value="high">Élevé</option>
                </select>
              ) : (
                <span className="text-[13px] font-medium text-foreground">{RISK_LABEL[dossier.risk_level]}</span>
              )}
            </MetaItem>
            <MetaItem label="Type de dossier">
              {editing ? (
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12.5px]"
                >
                  {CASE_TYPE_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[13px] font-medium text-foreground">
                  {getCaseTypeMeta(dossier.category).label}
                </span>
              )}
            </MetaItem>
            <MetaItem label="Créé le">
              <span className="text-[13px] text-foreground">
                {new Date(dossier.created_at).toLocaleDateString("fr-FR")}
              </span>
            </MetaItem>
          </aside>
        </div>
      </div>

      <div className="px-1">
        <Dossier360Tabs dossierId={id} />
      </div>

      {showDeadlineForm && (
        <DeadlineModal
          dossierId={id}
          onClose={() => setShowDeadlineForm(false)}
          onSaved={() => {
            setShowDeadlineForm(false);
            void refresh();
          }}
          createFn={createDeadlineFn}
        />
      )}
    </AppShell>
  );
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function DeadlineModal({
  dossierId,
  onClose,
  onSaved,
  createFn,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
  createFn: ReturnType<typeof useServerFn<typeof createDeadline>>;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", due_date: "" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.due_date) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossier_id: dossierId,
          title: form.title,
          description: form.description,
          due_date: new Date(form.due_date).toISOString(),
        },
      });
      toast.success("Échéance créée");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-popover p-6 shadow-[var(--shadow-elevated)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-foreground">Nouvelle échéance</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium">Titre *</span>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="ex. Entretien préalable"
              className="h-10 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium">Date *</span>
            <input
              required
              type="datetime-local"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="h-10 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium">Notes</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-accent"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-[13px] hover:bg-secondary">
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
