import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Link2,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import {
  listPendingLinks,
  confirmDocumentLink,
  rejectDocumentLink,
} from "@/lib/server-fns/document-links.functions";

export const Route = createFileRoute("/_authenticated/links")({
  head: () => ({ meta: [{ title: "Suggestions de liaison · JurisAI" }] }),
  component: LinksPage,
});

type PendingLink = {
  id: string;
  document_id: string;
  dossier_id: string;
  link_method: string;
  confidence: number;
  signals: Record<string, unknown> | null;
  created_at: string;
  document_analyses?: { filename: string | null } | null;
  dossiers?: { title: string | null } | null;
};

function LinksPage() {
  const fetchFn = useServerFn(listPendingLinks);
  const confirmFn = useServerFn(confirmDocumentLink);
  const rejectFn = useServerFn(rejectDocumentLink);
  const [items, setItems] = useState<PendingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchFn({})
      .then((d) => setItems((d.links ?? []) as PendingLink[]))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [fetchFn]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirm(id: string) {
    setBusyId(id);
    try {
      await confirmFn({ data: { link_id: id } });
      toast.success("Rattachement confirmé");
      setItems((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setBusyId(id);
    try {
      await rejectFn({ data: { link_id: id } });
      toast.success("Suggestion rejetée");
      setItems((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6 overflow-y-auto pb-10">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-aurora text-white shadow-glow">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold tracking-tight text-foreground">
              Suggestions de liaison
            </h1>
            <p className="text-[13px] text-muted-foreground">
              JurisAI a détecté des correspondances probables entre vos documents
              et vos dossiers. Validez ou rejetez chaque proposition.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-[14px] font-medium text-foreground">
              Aucune suggestion en attente
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              Les nouveaux documents s'y afficheront automatiquement quand un
              rattachement probable sera détecté.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((l) => {
              const pct = Math.round((l.confidence ?? 0) * 100);
              const tone =
                pct >= 70
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                  : pct >= 55
                    ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                    : "bg-secondary text-foreground border-border";
              return (
                <li
                  key={l.id}
                  className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
                >
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-foreground">
                          {l.document_analyses?.filename ?? "Document"}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground">
                          <Link
                            to="/documents/$id"
                            params={{ id: l.document_id }}
                            className="text-accent hover:underline"
                          >
                            ouvrir le document
                          </Link>
                        </p>
                      </div>
                    </div>

                    <div className="hidden text-muted-foreground sm:block">→</div>

                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-foreground">
                          {l.dossiers?.title ?? "Dossier"}
                        </p>
                        <Link
                          to="/dossiers/$id"
                          params={{ id: l.dossier_id }}
                          className="text-[11.5px] text-accent hover:underline"
                        >
                          ouvrir le dossier
                        </Link>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
                    >
                      <Sparkles className="h-3 w-3" />
                      {pct}%
                    </span>
                  </div>

                  {l.signals && Object.keys(l.signals).length > 0 ? (
                    <p className="mt-2 line-clamp-2 text-[11.5px] text-muted-foreground">
                      Indices :{" "}
                      {Object.entries(l.signals)
                        .map(([k, v]) =>
                          typeof v === "number"
                            ? `${k}=${(v as number).toFixed(2)}`
                            : Array.isArray(v)
                              ? `${k}(${(v as unknown[]).length})`
                              : `${k}`,
                        )
                        .join(" · ")}
                    </p>
                  ) : null}

                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleReject(l.id)}
                      disabled={busyId === l.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition hover:bg-secondary/50 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Rejeter
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirm(l.id)}
                      disabled={busyId === l.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-50"
                    >
                      {busyId === l.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Confirmer
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
