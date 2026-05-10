import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { listNotifications, markNotificationRead } from "@/server/notifications.functions";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Notif = {
  id: string; kind: string; title: string; body: string | null; link: string | null;
  read_at: string | null; created_at: string;
};

export function NotificationBell() {
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationRead);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.read_at).length;

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    try { setItems(await listFn() as Notif[]); }
    catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (authLoading || !user) return;
    void refresh();
    const t = setInterval(refresh, 60_000);

    // Realtime push : nouvelle notification pour cet utilisateur
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as Notif;
          setItems((prev) =>
            prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 30),
          );
        },
      )
      .subscribe();

    return () => {
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleClick = async (n: Notif) => {
    if (!n.read_at) await markFn({ data: { notificationId: n.id } });
    setOpen(false);
    if (n.link) void navigate({ to: n.link });
    void refresh();
  };

  const markAll = async () => {
    await markFn({ data: { all: true } });
    void refresh();
  };

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-foreground/70 hover:bg-secondary hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] rounded-2xl border border-border bg-popover shadow-[var(--shadow-elevated)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-[13px] font-semibold text-foreground">Notifications</p>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <CheckCheck className="h-3 w-3" /> Tout marquer lu
              </button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-accent" /></div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">Aucune notification</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleClick(n)}
                      className={cn(
                        "w-full px-4 py-3 text-left transition hover:bg-secondary",
                        !n.read_at && "bg-accent-soft/30",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-foreground">{n.title}</p>
                          {n.body && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">{n.body}</p>}
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {new Date(n.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
