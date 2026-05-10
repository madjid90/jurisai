import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";
import {
  CASE_STATUS_OPTIONS,
  CASE_TYPE_OPTIONS,
  STATUS_TONE_CLASS,
  getCaseStatusMeta,
  getCaseTypeMeta,
} from "@/lib/dossiers/case-meta";
import {
  createClient,
  createDeadline,
  createDossier,
  deleteClient,
  deleteDossier,
  listClients,
  listDeadlines,
  listDossiers,
  updateDeadline,
} from "@/server/crm.functions";

export const Route = createFileRoute("/_authenticated/dossiers")({
  head: () => ({ meta: [{ title: "Dossiers · JurisAI" }] }),
  component: DossiersPage,
});

type Tab = "dossiers" | "clients" | "deadlines";

type ClientRow = {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  contract_type: string | null;
  hire_date: string | null;
  phone: string | null;
};

type DossierRow = {
  id: string;
  title: string;
  category: string;
  status: string;
  risk_level: "low" | "medium" | "high";
  updated_at: string;
  client?: { id: string; full_name: string } | null;
};

type DeadlineRow = {
  id: string;
  title: string;
  due_date: string;
  completed: boolean;
  dossier?: {
    id: string;
    title: string;
    client?: { id: string; full_name: string } | null;
  } | null;
};

const RISK_COLOR: Record<DossierRow["risk_level"], string> = {
  low: "bg-secondary text-muted-foreground",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  high: "bg-destructive/15 text-destructive",
};

const RISK_LABEL: Record<DossierRow["risk_level"], string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
};

function DossiersPage() {
  const confirmAsync = useConfirm();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("dossiers");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);

  const [showClientForm, setShowClientForm] = useState(false);
  const [showDossierForm, setShowDossierForm] = useState(false);
  const [showDeadlineForm, setShowDeadlineForm] = useState(false);

  const listClientsFn = useServerFn(listClients);
  const listDossiersFn = useServerFn(listDossiers);
  const listDeadlinesFn = useServerFn(listDeadlines);
  const deleteClientFn = useServerFn(deleteClient);
  const deleteDossierFn = useServerFn(deleteDossier);
  const updateDeadlineFn = useServerFn(updateDeadline);

  const refresh = async () => {
    setLoading(true);
    try {
      const [c, d, dl] = await Promise.all([
        listClientsFn(),
        listDossiersFn({ data: { limit: 100, offset: 0 } }),
        listDeadlinesFn(),
      ]);
      setClients((c.clients ?? []) as ClientRow[]);
      setDossiers((d.dossiers ?? []) as DossierRow[]);
      setDeadlines((dl.deadlines ?? []) as DeadlineRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Filtered lists
  const filteredClients = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.job_title?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const filteredDossiers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return dossiers;
    return dossiers.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.client?.full_name.toLowerCase().includes(q),
    );
  }, [dossiers, search]);

  const upcomingDeadlines = useMemo(() => {
    return [...deadlines].sort((a, b) =>
      a.due_date.localeCompare(b.due_date),
    );
  }, [deadlines]);

  const stats = useMemo(() => {
    const open = dossiers.filter((d) => d.status !== "closed").length;
    const high = dossiers.filter((d) => d.risk_level === "high").length;
    const overdue = deadlines.filter(
      (d) => !d.completed && new Date(d.due_date) < new Date(),
    ).length;
    return { open, high, overdue };
  }, [dossiers, deadlines]);

  const handleDeleteClient = async (id: string) => {
    if (!(await confirmAsync("Supprimer ce client ? Les dossiers associés resteront mais ne seront plus liés."))) return;
    try {
      await deleteClientFn({ data: { id } });
      toast.success("Client supprimé");
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleDeleteDossier = async (id: string) => {
    if (!(await confirmAsync("Supprimer ce dossier et toutes ses échéances ?"))) return;
    try {
      await deleteDossierFn({ data: { id } });
      toast.success("Dossier supprimé");
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleToggleDeadline = async (d: DeadlineRow) => {
    try {
      await updateDeadlineFn({ data: { id: d.id, completed: !d.completed } });
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-hidden rounded-3xl shadow-[var(--shadow-card)]">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="border-b border-border px-8 py-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[22px] font-bold text-foreground">
                  Dossiers & Clients
                </h1>
                <p className="mt-1 text-[13.5px] text-muted-foreground">
                  Suivez vos salariés, dossiers RH et échéances clés.
                </p>
              </div>
              <div className="flex gap-2">
                {tab === "clients" && (
                  <button
                    onClick={() => setShowClientForm(true)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
                  >
                    <Plus className="h-4 w-4" /> Nouveau client
                  </button>
                )}
                {tab === "dossiers" && (
                  <button
                    onClick={() => setShowDossierForm(true)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
                  >
                    <Plus className="h-4 w-4" /> Nouveau dossier
                  </button>
                )}
                {tab === "deadlines" && (
                  <button
                    onClick={() => setShowDeadlineForm(true)}
                    disabled={dossiers.length === 0}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" /> Nouvelle échéance
                  </button>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <StatCard icon={Briefcase} label="Dossiers actifs" value={stats.open} />
              <StatCard icon={AlertCircle} label="Risque élevé" value={stats.high} tone="danger" />
              <StatCard icon={Clock} label="Échéances en retard" value={stats.overdue} tone="warning" />
            </div>

            {/* Tabs */}
            <div className="mt-6 flex gap-1 border-b border-border/60 -mb-6">
              <TabButton active={tab === "dossiers"} onClick={() => setTab("dossiers")} icon={Briefcase}>
                Dossiers ({dossiers.length})
              </TabButton>
              <TabButton active={tab === "clients"} onClick={() => setTab("clients")} icon={Users}>
                Clients ({clients.length})
              </TabButton>
              <TabButton active={tab === "deadlines"} onClick={() => setTab("deadlines")} icon={CalendarDays}>
                Échéances ({deadlines.filter((d) => !d.completed).length})
              </TabButton>
            </div>
          </div>

          {/* Search */}
          {tab !== "deadlines" && (
            <div className="border-b border-border px-8 py-3">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-auto px-8 py-6">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            ) : (
              <>
                {tab === "clients" && (
                  <ClientsList
                    clients={filteredClients}
                    onDelete={handleDeleteClient}
                  />
                )}
                {tab === "dossiers" && (
                  <DossiersList
                    dossiers={filteredDossiers}
                    onDelete={handleDeleteDossier}
                    onOpen={(id) => navigate({ to: "/dossiers/$id", params: { id } })}
                  />
                )}
                {tab === "deadlines" && (
                  <DeadlinesList
                    deadlines={upcomingDeadlines}
                    onToggle={handleToggleDeadline}
                    onOpen={(dossierId) => navigate({ to: "/dossiers/$id", params: { id: dossierId } })}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showClientForm && (
        <ClientFormModal
          onClose={() => setShowClientForm(false)}
          onSaved={() => {
            setShowClientForm(false);
            void refresh();
          }}
        />
      )}
      {showDossierForm && (
        <DossierFormModal
          clients={clients}
          onClose={() => setShowDossierForm(false)}
          onSaved={() => {
            setShowDossierForm(false);
            void refresh();
          }}
        />
      )}
      {showDeadlineForm && (
        <DeadlineFormModal
          dossiers={dossiers}
          onClose={() => setShowDeadlineForm(false)}
          onSaved={() => {
            setShowDeadlineForm(false);
            void refresh();
          }}
        />
      )}
    </AppShell>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-accent";
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", toneClass)} />
        <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-2 text-[24px] font-bold text-foreground">{value}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 border-b-2 px-3 pb-3 pt-2 text-[13px] font-medium transition",
        active
          ? "border-accent text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function ClientsList({
  clients,
  onDelete,
}: {
  clients: ClientRow[];
  onDelete: (id: string) => void;
}) {
  return (
    <VirtualList<ClientRow>
      items={clients}
      estimateSize={72}
      gap={8}
      getKey={(c) => c.id}
      maxHeight="100%"
      emptyState={<EmptyState icon={Users} title="Aucun client" hint="Créez votre premier client salarié pour démarrer." />}
      renderItem={(c) => (
        <div className="group flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 transition hover:border-accent/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[13px] font-semibold text-primary-foreground">
            {c.full_name
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-foreground">{c.full_name}</p>
            <p className="truncate text-[12px] text-muted-foreground">
              {[c.job_title, c.contract_type, c.email].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <button
            onClick={() => onDelete(c.id)}
            className="rounded-lg p-2 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    />
  );
}

function DossiersList({
  dossiers,
  onDelete,
  onOpen,
}: {
  dossiers: DossierRow[];
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <VirtualList<DossierRow>
      items={dossiers}
      estimateSize={84}
      gap={8}
      getKey={(d) => d.id}
      maxHeight="100%"
      emptyState={<EmptyState icon={Briefcase} title="Aucun dossier" hint="Créez un dossier pour commencer le suivi." />}
      renderItem={(d) => (
        <div className="group flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 transition hover:border-accent/40">
          <button onClick={() => onOpen(d.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[14px] font-semibold text-foreground">{d.title}</p>
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10.5px] font-semibold",
                    STATUS_TONE_CLASS[getCaseStatusMeta(d.status).tone],
                  )}
                >
                  {getCaseStatusMeta(d.status).label}
                </span>
                <span className={cn("rounded-md px-2 py-0.5 text-[10.5px] font-semibold", RISK_COLOR[d.risk_level])}>
                  Risque {RISK_LABEL[d.risk_level]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {d.client?.full_name ?? "Sans client"} · {getCaseTypeMeta(d.category).label}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => onDelete(d.id)}
            className="rounded-lg p-2 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    />
  );
}

function DeadlinesList({
  deadlines,
  onToggle,
  onOpen,
}: {
  deadlines: DeadlineRow[];
  onToggle: (d: DeadlineRow) => void;
  onOpen: (dossierId: string) => void;
}) {
  const now = new Date();
  return (
    <VirtualList<DeadlineRow>
      items={deadlines}
      estimateSize={76}
      gap={8}
      getKey={(d) => d.id}
      maxHeight="100%"
      emptyState={<EmptyState icon={CalendarDays} title="Aucune échéance" hint="Ajoutez une échéance à un dossier ouvert." />}
      renderItem={(d) => {
        const due = new Date(d.due_date);
        const overdue = !d.completed && due < now;
        return (
          <div
            className={cn(
              "flex items-center gap-4 rounded-xl border bg-card p-4 transition",
              overdue ? "border-destructive/40" : "border-border/60 hover:border-accent/40",
              d.completed && "opacity-60",
            )}
          >
            <button
              onClick={() => onToggle(d)}
              className={cn(
                "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition",
                d.completed
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-border hover:border-accent",
              )}
            >
              {d.completed && <CheckCircle2 className="h-4 w-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-[14px] font-semibold text-foreground", d.completed && "line-through")}>
                {d.title}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {d.dossier?.title}
                {d.dossier?.client?.full_name && ` · ${d.dossier.client.full_name}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className={cn("text-right text-[12px]", overdue ? "text-destructive font-semibold" : "text-muted-foreground")}>
                {due.toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
                {overdue && <span className="ml-2">⚠</span>}
              </div>
              {d.dossier?.id && (
                <button
                  onClick={() => onOpen(d.dossier!.id)}
                  className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-popover p-6 shadow-[var(--shadow-elevated)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-foreground">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-accent";

function ClientFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const createFn = useServerFn(createClient);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    job_title: "",
    contract_type: "",
    hire_date: "",
    notes: "",
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setBusy(true);
    try {
      await createFn({ data: form });
      toast.success("Client créé");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Nouveau client" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nom complet *">
          <input
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Poste">
            <input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Type de contrat">
            <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="Stage">Stage</option>
              <option value="Alternance">Alternance</option>
              <option value="Intérim">Intérim</option>
              <option value="Freelance">Freelance</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Téléphone">
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <Field label="Date d'embauche">
          <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Notes confidentielles">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-accent"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-[13px] font-medium hover:bg-secondary">
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
    </ModalShell>
  );
}

function DossierFormModal({
  clients,
  onClose,
  onSaved,
}: {
  clients: ClientRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createDossier);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    client_id: "",
    category: "autre",
    status: "open" as DossierRow["status"],
    risk_level: "low" as DossierRow["risk_level"],
    description: "",
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await createFn({ data: form });
      toast.success("Dossier créé");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Nouveau dossier" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Titre du dossier *">
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="ex. Licenciement éco. — Dupont"
            className={inputCls}
          />
        </Field>
        <Field label="Client / Salarié">
          <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls}>
            <option value="">— Aucun —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {CASE_TYPE_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {CASE_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Risque">
            <select value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value as DossierRow["risk_level"] })} className={inputCls}>
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-accent"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-[13px] font-medium hover:bg-secondary">
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
    </ModalShell>
  );
}

function DeadlineFormModal({
  dossiers,
  onClose,
  onSaved,
}: {
  dossiers: DossierRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createDeadline);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    dossier_id: dossiers[0]?.id ?? "",
    title: "",
    description: "",
    due_date: "",
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.dossier_id || !form.due_date) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          ...form,
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
    <ModalShell title="Nouvelle échéance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Dossier *">
          <select
            required
            value={form.dossier_id}
            onChange={(e) => setForm({ ...form, dossier_id: e.target.value })}
            className={inputCls}
          >
            <option value="">— Choisir —</option>
            {dossiers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.client ? ` (${d.client.full_name})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Titre *">
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="ex. Entretien préalable"
            className={inputCls}
          />
        </Field>
        <Field label="Date d'échéance *">
          <input
            required
            type="datetime-local"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-accent"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-[13px] font-medium hover:bg-secondary">
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
    </ModalShell>
  );
}
