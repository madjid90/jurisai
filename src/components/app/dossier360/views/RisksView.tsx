// G6 — RisksView extrait de Dossier360Tabs.
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Shield } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { updateRiskStatus } from "@/server/dossier360.functions";
import { Empty, SectionHeader } from "../shared";
import { RISK_STATUS_LABEL, SEVERITY_LABEL, SEVERITY_STYLE, type Risk } from "../types";

export function RisksView({
  risks,
  dossierId,
  onAdd,
  onChanged,
}: {
  risks: Risk[];
  dossierId: string;
  onAdd: () => void;
  onChanged: () => void;
}) {
  const updateFn = useServerFn(updateRiskStatus);
  const handleStatus = async (riskId: string, status: Risk["status"]) => {
    try {
      await updateFn({ data: { riskId, dossierId, status } });
      toast.success("Statut mis à jour");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div>
      <SectionHeader title="Risques juridiques" onAdd={onAdd} addLabel="Identifier un risque" />
      {risks.length === 0 ? (
        <Empty icon={Shield} title="Aucun risque identifié" hint="Identifiez les risques juridiques (rupture, conformité, contentieux…) pour les suivre." />
      ) : (
        <div className="space-y-2">
          {risks.map((r) => (
            <div key={r.id} className={cn("rounded-xl border p-3", r.status === "resolved" ? "opacity-60" : "", "border-border/60 bg-background")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase", SEVERITY_STYLE[r.severity])}>
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {SEVERITY_LABEL[r.severity]}
                    </span>
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{r.category}</span>
                    <span className="text-[10.5px] text-muted-foreground">{RISK_STATUS_LABEL[r.status]}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-semibold text-foreground">{r.title}</p>
                  {r.description && <p className="mt-1 text-[12px] text-muted-foreground">{r.description}</p>}
                  {Array.isArray(r.legal_basis) && r.legal_basis.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Base légale :{" "}
                      {(r.legal_basis as Array<{ source?: string }>).map((b) => b.source).filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {r.mitigation && (
                    <p className="mt-1 rounded-md bg-secondary/50 p-1.5 text-[11.5px] text-foreground">
                      <span className="font-semibold">Mitigation : </span>
                      {r.mitigation}
                    </p>
                  )}
                </div>
                <select
                  value={r.status}
                  onChange={(e) => handleStatus(r.id, e.target.value as Risk["status"])}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-[11.5px]"
                >
                  <option value="open">Ouvert</option>
                  <option value="mitigating">En traitement</option>
                  <option value="resolved">Résolu</option>
                  <option value="accepted">Accepté</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
