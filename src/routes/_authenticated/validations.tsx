// Page Validations — file des demandes que l'utilisateur courant doit
// approuver ou refuser. C'est le cœur du workflow "service juridique interne" :
// un junior (ou l'agent) prépare, un sénior valide.
//
// Realtime : on s'abonne à validation_requests pour recharger live quand une
// nouvelle demande arrive (ou qu'une autre personne en a validé une).

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, Loader2, Inbox, FileText, Briefcase, Clock } from "lucide-react";
import { listPendingValidations, decideValidation } from "@/server/validations.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/validations")({
  head: () => ({ meta: [{ title: "Validations · JurisAI" }] }),
  component: ValidationsPage,
});

type Validation = {
  id: string;
  dossier_id: string | null;
  requested_by: string;
  assigned_to: string | null;
  subject_type: string;
  subject_id: string | null;
  comment: string | null;
  status: string;
  created_at: string;
  dossier: { id: string; title: string; category: string; risk_level: string } | null;
  requested_by_user: { id: string; full_name: string | null; email: string | null } | null;
};

const SUBJECT_LABEL: Record<string, string> = {
  generated_document: "Document généré",
  agent_run: "Réponse agent sensible",
  workflow_step: "Étape de procédure",
  contract: "Contrat",
  reminder: "Rappel",
};

const RISK_COLOR: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

function ValidationsPage() {
  const listFn = useServerFn(listPendingValidations);
  const decideFn = useServerFn(decideValidation);
  const navigate = useNavigate();
  const { profile, user } = useAuth();

  const [items, setItems] = useState<Validation[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "tenant">("mine");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [commentFor, setCommentFor] = useState<Record<string, string>>({});

  const refresh = async () => {
    if (!profile?.onboarded) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = (await listFn({ data: { scope, limit: 100 } })) as Validation[];
      setItems(rows);
    } catch (e) {
      console.error(e);
      toast.error("Impossible de charger les validations", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, profile?.onboarded]);

  // Realtime : on rafraîchit dès qu'un INSERT/UPDATE arrive sur validation_requests
  useEffect(() => {
    if (!profile?.onboarded || !user?.id) return;
    const channel = supabase
      .channel(`validations-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "validation_requests" },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.onboarded, user?.id, scope]);

  if (!profile?.onboarded) return null;

  const decide = async (id: string, approved: boolean) => {
    setDecidingId(id);
    try {
      await decideFn({
        data: { validationId: id, approved, comment: commentFor[id] || undefined },
      });
      toast.success(approved ? "Validation approuvée" : "Validation refusée");
      // Optimistic : on retire la ligne tout de suite
      setItems((prev) => prev.filter((v) => v.id !== id));
    } catch (e) {
      toast.error("Décision impossible", {
        description: (e as Error).message,
      });
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Validations à faire</h1>
        <p className="text-sm text-muted-foreground">
          Les actions sensibles préparées par votre équipe ou par l'agent attendent votre
          décision. Approuvez pour débloquer, refusez avec un commentaire pour renvoyer au demandeur.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <Button
          variant={scope === "mine" ? "default" : "outline"}
          size="sm"
          onClick={() => setScope("mine")}
        >
          Pour moi
        </Button>
        <Button
          variant={scope === "tenant" ? "default" : "outline"}
          size="sm"
          onClick={() => setScope("tenant")}
        >
          Toutes (équipe)
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          {items.length} en attente
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 mb-2 opacity-40" />
          <p className="text-sm">Aucune validation en attente.</p>
          <p className="text-xs mt-1 opacity-70">
            Les nouvelles demandes apparaissent ici en temps réel.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((v) => {
            const subjectLabel = SUBJECT_LABEL[v.subject_type] ?? v.subject_type;
            const dossier = v.dossier;
            const requester =
              v.requested_by_user?.full_name ||
              v.requested_by_user?.email ||
              "Demandeur inconnu";
            return (
              <article
                key={v.id}
                className="rounded-lg border border-border/60 bg-card p-4 space-y-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="font-medium text-sm truncate">{subjectLabel}</span>
                      {dossier && (
                        <Badge
                          variant="secondary"
                          className={`text-xs ${RISK_COLOR[dossier.risk_level] ?? ""}`}
                        >
                          {dossier.risk_level}
                        </Badge>
                      )}
                    </div>
                    {dossier && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate({ to: "/dossiers/$id", params: { id: dossier.id } })
                        }
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Briefcase className="h-3 w-3" />
                        <span className="truncate max-w-[260px]">{dossier.title}</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {timeAgo(v.created_at)}
                  </div>
                </div>

                <div className="text-sm text-foreground/80">
                  <span className="text-muted-foreground">Demandé par : </span>
                  {requester}
                </div>

                {v.comment && (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed">
                    {v.comment}
                  </div>
                )}

                <Textarea
                  placeholder="Commentaire (visible par le demandeur) — optionnel"
                  className="text-sm min-h-[60px]"
                  value={commentFor[v.id] ?? ""}
                  onChange={(e) =>
                    setCommentFor((prev) => ({ ...prev, [v.id]: e.target.value }))
                  }
                  disabled={decidingId === v.id}
                />

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => void decide(v.id, true)}
                    disabled={decidingId !== null}
                    className="gap-1.5"
                  >
                    {decidingId === v.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Approuver
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decide(v.id, false)}
                    disabled={decidingId !== null}
                    className="gap-1.5"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Refuser
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
