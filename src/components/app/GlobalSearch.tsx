import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Search, FolderOpen, Users, FileText, Loader2 } from "lucide-react";
import { globalSearch } from "@/server/collaboration.functions";

type Results = {
  dossiers: Array<{ id: string; title: string; status: string; category: string }>;
  clients: Array<{ id: string; full_name: string; email: string | null; job_title: string | null }>;
  documents: Array<{ id: string; title: string; status: string }>;
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const searchFn = useServerFn(globalSearch);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>({ dossiers: [], clients: [], documents: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!q.trim()) { setResults({ dossiers: [], clients: [], documents: [] }); return; }
    const id = setTimeout(async () => {
      setLoading(true);
      try { setResults((await searchFn({ data: { q: q.trim() } })) as Results); }
      catch { /* silent */ }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(id);
  }, [q, searchFn]);

  const go = (path: string) => { setOpen(false); setQ(""); void navigate({ to: path }); };

  const total = results.dossiers.length + results.clients.length + results.documents.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[12.5px] text-muted-foreground hover:bg-secondary"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Rechercher…</span>
        <kbd className="hidden rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-popover shadow-[var(--shadow-elevated)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher dossiers, clients, documents…"
                className="flex-1 bg-transparent py-3.5 text-[14px] outline-none"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="max-h-[400px] overflow-y-auto p-2">
              {!q.trim() ? (
                <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
                  Tapez pour rechercher dans votre espace
                </p>
              ) : total === 0 && !loading ? (
                <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">Aucun résultat</p>
              ) : (
                <>
                  {results.dossiers.length > 0 && (
                    <Section label="Dossiers">
                      {results.dossiers.map((d) => (
                        <ResultItem key={d.id} icon={FolderOpen} title={d.title} subtitle={d.category} onClick={() => go(`/dossiers/${d.id}`)} />
                      ))}
                    </Section>
                  )}
                  {results.clients.length > 0 && (
                    <Section label="Clients">
                      {results.clients.map((c) => (
                        <ResultItem key={c.id} icon={Users} title={c.full_name} subtitle={c.job_title ?? c.email ?? ""} onClick={() => go(`/dossiers`)} />
                      ))}
                    </Section>
                  )}
                  {results.documents.length > 0 && (
                    <Section label="Documents">
                      {results.documents.map((d) => (
                        <ResultItem key={d.id} icon={FileText} title={d.title} subtitle={d.status} onClick={() => go(`/documents/${d.id}`)} />
                      ))}
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul>{children}</ul>
    </div>
  );
}

function ResultItem({ icon: Icon, title, subtitle, onClick }: {
  icon: any; title: string; subtitle: string; onClick: () => void;
}) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
          {subtitle && <p className="truncate text-[11.5px] text-muted-foreground">{subtitle}</p>}
        </div>
      </button>
    </li>
  );
}
