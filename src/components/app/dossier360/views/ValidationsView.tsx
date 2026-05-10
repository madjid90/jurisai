// G6 — ValidationsView extrait de Dossier360Tabs.
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { decideValidation } from "@/server/dossier360.functions";
import { Empty, SectionHeader } from "../shared";
import type { Validation } from "../types";

export function ValidationsView({
  validations,
  onAdd,
  onChanged,
}: {
  validations: Validation[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const decideFn = useServerFn(decideValidation);
  const handle = async (id: string, decision: "approved" | "rejected") => {
    try {
      await decideFn({ data: { validationId: id, decision } });
      toast.success(decision === "approved" ? "Approuvé" : "Rejeté");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div>
      <SectionHeader title="Validations" onAdd={onAdd} addLabel="Demander une validation" />
      {validations.length === 0 ? (
        <Empty icon={CheckCircle2} title="Aucune validation" hint="Pour les actions engageantes, demandez une validation hiérarchique." />
      ) : (
        <div className="space-y-2">
          {validations.map((v) => (
            <div key={v.id} className="rounded-xl border border-border/60 bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-foreground">{v.subject_type}</p>
                  {v.comment && <p className="mt-1 text-[12px] text-muted-foreground">{v.comment}</p>}
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    Demandé le {new Date(v.created_at).toLocaleDateString("fr-FR")}
                  </p>
                  {v.decision_comment && (
                    <p className="mt-1 rounded-md bg-secondary/50 p-1.5 text-[11.5px]">Décision : {v.decision_comment}</p>
                  )}
                </div>
                {v.status === "pending" ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => handle(v.id, "approved")} className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-500/40 px-2 text-[11.5px] font-medium text-emerald-600 hover:bg-emerald-500/10">
                      <CheckCircle2 className="h-3 w-3" /> Approuver
                    </button>
                    <button onClick={() => handle(v.id, "rejected")} className="inline-flex h-8 items-center gap-1 rounded-lg border border-destructive/40 px-2 text-[11.5px] font-medium text-destructive hover:bg-destructive/10">
                      <XCircle className="h-3 w-3" /> Rejeter
                    </button>
                  </div>
                ) : (
                  <span className={cn("rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase", v.status === "approved" ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive")}>
                    {v.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
