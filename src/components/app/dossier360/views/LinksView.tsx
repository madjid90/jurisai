// G6 — LinksView extrait de Dossier360Tabs.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileText, Link2, Loader2, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  confirmDocumentLink,
  getDocumentsForDossier,
  rejectDocumentLink,
} from "@/server/document-links.functions";
import { Empty } from "../shared";

type DossierLink = {
  id: string;
  document_id: string;
  status: "pending" | "confirmed" | "rejected";
  link_method: string;
  confidence: number;
  signals: Record<string, unknown> | null;
  document_analyses?: {
    id: string;
    filename: string | null;
    file_type: string | null;
    created_at: string;
    status: string | null;
  } | null;
};

export function LinksView({ dossierId }: { dossierId: string }) {
  const fetchFn = useServerFn(getDocumentsForDossier);
  const confirmFn = useServerFn(confirmDocumentLink);
  const rejectFn = useServerFn(rejectDocumentLink);
  const [links, setLinks] = useState<DossierLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchFn({ data: { dossier_id: dossierId } });
      setLinks((res.links ?? []) as DossierLink[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
      </div>
    );
  }

  if (links.length === 0) {
    return <Empty icon={Link2} title="Aucun document lié" hint="Les documents uploadés sont automatiquement reliés à ce dossier dès qu'une correspondance est détectée." />;
  }

  const pending = links.filter((l) => l.status === "pending");
  const confirmed = links.filter((l) => l.status === "confirmed");

  async function act(linkId: string, kind: "confirm" | "reject") {
    setBusy(linkId);
    try {
      if (kind === "confirm") await confirmFn({ data: { link_id: linkId } });
      else await rejectFn({ data: { link_id: linkId } });
      toast.success(kind === "confirm" ? "Lien confirmé" : "Lien rejeté");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(null);
    }
  }

  function renderItem(l: DossierLink) {
    const pct = Math.round((l.confidence ?? 0) * 100);
    return (
      <li key={l.id} className="flex items-start gap-3 rounded-xl border border-border/60 bg-background p-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <Link to="/documents/$id" params={{ id: l.document_id }} className="block truncate text-[13px] font-semibold text-foreground hover:underline">
            {l.document_analyses?.filename ?? "Document"}
          </Link>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {l.link_method} · confiance {pct}%
            {l.document_analyses?.file_type ? ` · ${l.document_analyses.file_type}` : ""}
          </p>
        </div>
        {l.status === "pending" ? (
          <div className="flex shrink-0 gap-1.5">
            <button type="button" onClick={() => act(l.id, "reject")} disabled={busy === l.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50">
              <XCircle className="h-3 w-3" /> Rejeter
            </button>
            <button type="button" onClick={() => act(l.id, "confirm")} disabled={busy === l.id} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50">
              {busy === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirmer
            </button>
          </div>
        ) : (
          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-600">Confirmé</span>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-amber-600">
            <Sparkles className="h-3.5 w-3.5" />
            Suggestions à valider ({pending.length})
          </h4>
          <ul className="space-y-2">{pending.map(renderItem)}</ul>
        </section>
      )}
      {confirmed.length > 0 && (
        <section>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Documents liés ({confirmed.length})</h4>
          <ul className="space-y-2">{confirmed.map(renderItem)}</ul>
        </section>
      )}
    </div>
  );
}
