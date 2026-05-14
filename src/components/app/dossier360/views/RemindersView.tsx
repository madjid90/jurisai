// G6 — RemindersView extrait de Dossier360Tabs.
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { dismissReminder } from "@/lib/server-fns/dossier360.functions";
import { Empty, SectionHeader } from "../shared";
import type { Reminder } from "../types";

export function RemindersView({
  reminders,
  onAdd,
  onChanged,
}: {
  reminders: Reminder[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const dismissFn = useServerFn(dismissReminder);
  const handleDismiss = async (id: string) => {
    try {
      await dismissFn({ data: { reminderId: id } });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div>
      <SectionHeader title="Rappels" onAdd={onAdd} addLabel="Programmer un rappel" />
      {reminders.length === 0 ? (
        <Empty icon={Bell} title="Aucun rappel programmé" hint="Programmez des rappels pour ne rien oublier (renouvellement, échéance…)." />
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => {
            const dt = new Date(r.remind_at);
            const past = dt < new Date();
            return (
              <div key={r.id} className={cn("flex items-center justify-between rounded-xl border border-border/60 bg-background p-3", r.dismissed_at && "opacity-50")}>
                <div>
                  <p className="text-[13px] font-semibold text-foreground">{r.title}</p>
                  {r.body && <p className="mt-0.5 text-[12px] text-muted-foreground">{r.body}</p>}
                  <p className={cn("mt-1 text-[11px]", past && !r.dismissed_at ? "font-semibold text-destructive" : "text-muted-foreground")}>
                    {dt.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                {!r.dismissed_at && (
                  <button onClick={() => handleDismiss(r.id)} className="rounded-lg border border-border px-2 py-1 text-[11.5px] hover:bg-secondary">
                    Marquer fait
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
