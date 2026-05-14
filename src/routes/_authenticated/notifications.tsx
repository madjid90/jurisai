// Page Notifications — flux pleine page (Lot 7 partiel : UI lecture + clic = navigate(target)).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, Loader2, Inbox } from "lucide-react";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/server/notifications.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

type Notif = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  rappel_retard: "Rappel en retard",
  action_requise: "Action requise",
  risque_detecte: "Risque détecté",
  echeance_proche: "Échéance proche",
  workflow_bloque: "Procédure bloquée",
  document_a_valider: "Document à valider",
  rapport_disponible: "Rapport disponible",
  nouvelle_mise_a_jour_juridique: "Veille juridique",
};

function NotificationsPage() {
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = (await listFn({ data: { limit: 100, unreadOnly: filter === "unread" } })) as Notif[];
      setItems(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const onClickItem = async (n: Notif) => {
    if (!n.read_at) {
      try {
        await markFn({ data: { notificationId: n.id } });
        setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read_at: new Date().toISOString() } : p)));
      } catch {/* noop */}
    }
    if (n.link) navigate({ to: n.link });
  };

  const onMarkAll = async () => {
    try {
      await markAllFn();
      toast.success("Toutes les notifications marquées comme lues");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est à jour"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onMarkAll} disabled={unread === 0}>
          <CheckCheck className="h-4 w-4 mr-1.5" />
          Tout marquer lu
        </Button>
      </header>

      <div className="flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              filter === f ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground/70 hover:bg-accent/40",
            )}
          >
            {f === "all" ? "Toutes" : "Non lues"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Inbox className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Aucune notification.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onClickItem(n)}
                className={cn(
                  "w-full text-left rounded-2xl border border-border/60 bg-card px-4 py-3 transition hover:border-accent/40 hover:bg-accent/5",
                  !n.read_at && "border-accent/30 bg-accent/5",
                )}
              >
                <div className="flex items-start gap-3">
                  {!n.read_at && (
                    <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{n.title}</p>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 flex-shrink-0">
                        {KIND_LABEL[n.kind] ?? n.kind}
                      </span>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      {new Date(n.created_at).toLocaleString("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
