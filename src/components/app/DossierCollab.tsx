import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircle, ListTodo, Trash2, Plus, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listComments, addComment, deleteComment,
  listTasks, createTask, updateTask, deleteTask,
  listTenantMembers,
} from "@/server/collaboration.functions";

type Member = { id: string; full_name: string | null; email: string; avatar_url: string | null };
type Comment = { id: string; body: string; user_id: string; created_at: string; author: Member | null };
type Task = {
  id: string; title: string; description: string | null;
  status: "todo" | "in_progress" | "done" | "blocked";
  priority: "low" | "normal" | "high" | "urgent";
  due_date: string | null; assigned_to: string | null; created_by: string;
  completed_at: string | null;
  assignee: Member | null; creator: Member | null;
};

const STATUS_LABEL = { todo: "À faire", in_progress: "En cours", done: "Terminé", blocked: "Bloqué" };
const PRIO_LABEL = { low: "Basse", normal: "Normale", high: "Haute", urgent: "Urgente" };
const PRIO_COLOR = {
  low: "bg-secondary text-muted-foreground",
  normal: "bg-secondary text-foreground",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  urgent: "bg-destructive/15 text-destructive",
};

export function DossierCollab({ dossierId }: { dossierId: string }) {
  const [tab, setTab] = useState<"comments" | "tasks">("comments");

  return (
    <section>
      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "comments"} onClick={() => setTab("comments")} icon={MessageCircle} label="Commentaires" />
        <TabButton active={tab === "tasks"} onClick={() => setTab("tasks")} icon={ListTodo} label="Tâches" />
      </div>
      <div className="mt-4">
        {tab === "comments" ? <CommentsTab dossierId={dossierId} /> : <TasksTab dossierId={dossierId} />}
      </div>
    </section>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: any; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition",
        active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// ─── COMMENTS ───────────────────────────────────────────────────────────────

function CommentsTab({ dossierId }: { dossierId: string }) {
  const listFn = useServerFn(listComments);
  const addFn = useServerFn(addComment);
  const delFn = useServerFn(deleteComment);
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { dossierId } });
      setItems(res as Comment[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [dossierId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await addFn({ data: { dossierId, body: body.trim() } });
      setBody("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce commentaire ?")) return;
    try { await delFn({ data: { commentId: id } }); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="rounded-xl border border-border bg-card p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Écrire un commentaire…"
          className="w-full resize-none bg-transparent text-[13px] outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-primary to-accent px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Publier
          </button>
        </div>
      </form>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          Aucun commentaire pour le moment.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-xl border border-border/60 bg-card p-3">
              <Avatar member={c.author} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12.5px] font-semibold text-foreground">
                    {c.author?.full_name ?? c.author?.email ?? "Utilisateur"}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">{c.body}</p>
              </div>
              <button onClick={() => remove(c.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Avatar({ member }: { member: Member | null }) {
  const initials = (member?.full_name ?? member?.email ?? "?")
    .split(" ").map((s) => s[0]?.toUpperCase() ?? "").slice(0, 2).join("") || "?";
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[11px] font-semibold text-primary-foreground">
      {initials}
    </div>
  );
}

// ─── TASKS ──────────────────────────────────────────────────────────────────

function TasksTab({ dossierId }: { dossierId: string }) {
  const listFn = useServerFn(listTasks);
  const createFn = useServerFn(createTask);
  const updateFn = useServerFn(updateTask);
  const deleteFn = useServerFn(deleteTask);
  const membersFn = useServerFn(listTenantMembers);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([listFn({ data: { dossierId } }), membersFn()]);
      setTasks(t as Task[]);
      setMembers(m as Member[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [dossierId]);

  const toggleStatus = async (t: Task) => {
    const next = t.status === "done" ? "todo" : "done";
    try { await updateFn({ data: { taskId: t.id, status: next } }); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette tâche ?")) return;
    try { await deleteFn({ data: { taskId: id } }); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-muted-foreground">{tasks.length} tâche{tasks.length > 1 ? "s" : ""}</p>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[12px] font-medium text-foreground hover:bg-accent-soft"
        >
          <Plus className="h-3.5 w-3.5" /> Nouvelle tâche
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
      ) : tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          Aucune tâche. Créez-en pour suivre le travail à effectuer.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className={cn(
              "flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3",
              t.status === "done" && "opacity-60",
            )}>
              <button
                onClick={() => toggleStatus(t)}
                className={cn(
                  "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition",
                  t.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:border-accent",
                )}
              >
                {t.status === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-[13px] font-semibold text-foreground", t.status === "done" && "line-through")}>
                  {t.title}
                </p>
                {t.description && <p className="mt-0.5 text-[12px] text-muted-foreground">{t.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", PRIO_COLOR[t.priority])}>
                    {PRIO_LABEL[t.priority]}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">
                    {STATUS_LABEL[t.status]}
                  </span>
                  {t.assignee && (
                    <span className="text-[11px] text-muted-foreground">
                      → {t.assignee.full_name ?? t.assignee.email}
                    </span>
                  )}
                  {t.due_date && (
                    <span className="text-[11px] text-muted-foreground">
                      📅 {new Date(t.due_date).toLocaleDateString("fr-FR")}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => remove(t.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <TaskFormModal
          dossierId={dossierId}
          members={members}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void refresh(); }}
          createFn={createFn}
        />
      )}
    </div>
  );
}

function TaskFormModal({
  dossierId, members, onClose, onSaved, createFn,
}: {
  dossierId: string; members: Member[];
  onClose: () => void; onSaved: () => void;
  createFn: ReturnType<typeof useServerFn<typeof createTask>>;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", assignedTo: "" as string,
    priority: "normal" as Task["priority"], dueDate: "",
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          assignedTo: form.assignedTo || null,
          priority: form.priority,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        },
      });
      toast.success("Tâche créée");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-foreground">Nouvelle tâche</h3>
        <div className="mt-4 space-y-3">
          <input
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Titre" required
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px]"
          />
          <textarea
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description (optionnelle)" rows={3}
            className="w-full rounded-lg border border-border bg-background p-3 text-[13px]"
          />
          <select
            value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px]"
          >
            <option value="">Non assignée</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Task["priority"] })}
              className="h-10 rounded-lg border border-border bg-background px-2 text-[13px]"
            >
              {(["low", "normal", "high", "urgent"] as const).map((p) => (
                <option key={p} value={p}>{PRIO_LABEL[p]}</option>
              ))}
            </select>
            <input
              type="datetime-local" value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="h-10 rounded-lg border border-border bg-background px-2 text-[13px]"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-[12.5px] hover:bg-secondary">
            Annuler
          </button>
          <button
            type="submit" disabled={busy || !form.title.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Créer
          </button>
        </div>
      </form>
    </div>
  );
}
