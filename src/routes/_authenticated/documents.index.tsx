import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  FileSignature,
  FileText,
  FileWarning,
  Loader2,
  Plus,
  Scale,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createDocument, deleteDocument, generateDocument } from "@/server/documents.functions";

export const Route = createFileRoute("/_authenticated/documents/")({
  head: () => ({ meta: [{ title: "Documents · JurisAI" }] }),
  component: DocumentsIndex,
});

type Template = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string | null;
  body: string;
  variables: Array<{ key: string; label: string; type?: string }>;
};

type PublicTemplate = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  content_md: string;
  variables: Array<{ key: string; label: string; type?: string }>;
  source_url: string | null;
  disclaimer: string | null;
  quality_level: string | null;
  legal_basis: string[] | null;
};

type DocRow = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  template_id: string | null;
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  AlertTriangle,
  FileSignature,
  FileWarning,
  Scale,
};

const CATEGORY_LABEL: Record<string, string> = {
  courrier: "Courrier",
  contrat: "Contrat",
  "mise-en-demeure": "Mise en demeure",
  note: "Note",
  autre: "Autre",
};

function DocumentsIndex() {
  const confirmAsync = useConfirm();
  const { user } = useAuth();
  const navigate = useNavigate();
  const createFn = useServerFn(createDocument);
  const generateFn = useServerFn(generateDocument);
  const deleteFn = useServerFn(deleteDocument);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [publicTpls, setPublicTpls] = useState<PublicTemplate[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTpl, setActiveTpl] = useState<Template | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [{ data: tpl }, { data: pub }, { data: dl }] = await Promise.all([
        supabase
          .from("document_templates")
          .select("id, name, description, category, icon, body, variables")
          .order("name"),
        supabase
          .from("templates_public")
          .select("id, title, description, category, content_md, variables, source_url, disclaimer, quality_level, legal_basis")
          .order("title")
          .limit(60),
        supabase
          .from("documents")
          .select("id, title, status, updated_at, template_id")
          .order("updated_at", { ascending: false })
          .limit(50),
      ]);
      setTemplates((tpl as unknown as Template[]) ?? []);
      setPublicTpls((pub as unknown as PublicTemplate[]) ?? []);
      setDocs((dl as unknown as DocRow[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [templates, search]);

  const filteredPublic = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return publicTpls;
    return publicTpls.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [publicTpls, search]);

  const onUsePublic = async (p: PublicTemplate) => {
    // Convert markdown-ish content to a minimal HTML body and open editor.
    const html =
      "<p>" +
      (p.content_md || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\r\n/g, "\n")
        .split(/\n\n+/)
        .map((p) => p.replace(/\n/g, "<br/>"))
        .join("</p><p>") +
      "</p>" +
      (p.disclaimer
        ? `<p><em style="color:#92400e">⚠ ${p.disclaimer.replace(/</g, "&lt;")}</em></p>`
        : "");
    try {
      const { id } = await createFn({ data: { title: p.title, content: html } });
      toast.success("Modèle importé");
      void navigate({ to: "/documents/$id", params: { id } });
    } catch (err) {
      toast.error("Import impossible", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const onCreateBlank = async () => {
    try {
      const { id } = await createFn({
        data: { title: "Nouveau document", content: "<p></p>" },
      });
      void navigate({ to: "/documents/$id", params: { id } });
    } catch (err) {
      toast.error("Création impossible", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const onDelete = async (id: string) => {
    if (!(await confirmAsync("Supprimer définitivement ce document ?"))) return;
    try {
      await deleteFn({ data: { id } });
      setDocs((d) => d.filter((x) => x.id !== id));
      toast.success("Document supprimé");
    } catch (err) {
      toast.error("Suppression impossible", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-8 px-6 py-8 lg:px-10">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wider text-accent">
            Documents
          </p>
          <h1 className="mt-1 text-[28px] font-bold tracking-tight text-foreground">
            Modèles & rédaction
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Générez vos courriers, contrats et mises en demeure en quelques clics.
          </p>
        </div>
        <button
          onClick={() => void onCreateBlank()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-[13px] font-medium text-foreground transition hover:bg-secondary"
        >
          <Plus className="h-4 w-4" />
          Document vierge
        </button>
      </header>

      {/* Templates */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-foreground">Modèles</h2>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un modèle…"
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-2xl border border-border bg-secondary/40"
              />
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Aucun modèle ne correspond.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredTemplates.map((t) => {
              const Icon = ICONS[t.icon ?? "FileText"] ?? FileText;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTpl(t)}
                  className="group flex h-full flex-col items-start gap-3 rounded-2xl border border-border bg-background p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-elegant)]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13.5px] font-semibold text-foreground">{t.name}</p>
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">
                      {t.description}
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABEL[t.category] ?? t.category}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Public template library (CDTN) */}
      {filteredPublic.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">Bibliothèque publique</h2>
              <p className="text-[12px] text-muted-foreground">
                Modèles issus de sources officielles (Code du travail numérique). À adapter avant envoi.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {filteredPublic.length} modèle{filteredPublic.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPublic.slice(0, 24).map((p) => (
              <article key={p.id} className="flex h-full flex-col gap-2 rounded-2xl border border-border bg-background p-4 shadow-sm">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <h3 className="text-[13.5px] font-semibold text-foreground">{p.title}</h3>
                </div>
                {p.description && (
                  <p className="line-clamp-3 text-[12.5px] text-muted-foreground">{p.description}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {p.category}
                  </span>
                  <button
                    onClick={() => void onUsePublic(p)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-3 text-[12px] font-medium text-foreground transition hover:bg-accent hover:text-accent-foreground"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Utiliser
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Recent docs */}
      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold text-foreground">Mes documents récents</h2>
        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl border border-border bg-secondary/40" />
        ) : docs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-background p-8 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-[13px] text-muted-foreground">
              Aucun document pour le moment. Choisissez un modèle ci-dessus pour commencer.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/40"
              >
                <Link
                  to="/documents/$id"
                  params={{ id: d.id }}
                  className="flex flex-1 items-center gap-3"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-foreground">
                      {d.title}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      Modifié le {new Date(d.updated_at).toLocaleString("fr-FR")} ·{" "}
                      {d.status === "final" ? "Finalisé" : "Brouillon"}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => void onDelete(d.id)}
                  className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Variables modal */}
      {activeTpl && (
        <TemplateModal
          template={activeTpl}
          onClose={() => setActiveTpl(null)}
          onGenerate={async (vars, prompt) => {
            try {
              const { content } = await generateFn({
                data: { templateId: activeTpl.id, variables: vars, prompt },
              });
              const { id } = await createFn({
                data: {
                  title: activeTpl.name,
                  content,
                  templateId: activeTpl.id,
                  variables: vars,
                },
              });
              setActiveTpl(null);
              toast.success("Document généré");
              void navigate({ to: "/documents/$id", params: { id } });
            } catch (err) {
              toast.error("Génération impossible", {
                description: err instanceof Error ? err.message : undefined,
              });
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: fill template variables ───────────────────────────────────────

function TemplateModal({
  template,
  onClose,
  onGenerate,
}: {
  template: Template;
  onClose: () => void;
  onGenerate: (vars: Record<string, string>, prompt: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onGenerate(values, prompt);
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl shadow-[var(--shadow-elevated)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-border px-6 py-5">
          <h2 className="text-[18px] font-bold text-foreground">{template.name}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{template.description}</p>
        </header>

        <form onSubmit={onSubmit} className="max-h-[calc(90vh-180px)] overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {template.variables.map((v) => (
              <label key={v.key} className="block sm:col-span-1">
                <span className="mb-1.5 block text-[12px] font-medium text-foreground/80">
                  {v.label}
                </span>
                {v.type === "textarea" ? (
                  <textarea
                    value={values[v.key] ?? ""}
                    onChange={(e) => set(v.key, e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:border-accent focus:outline-none"
                  />
                ) : (
                  <input
                    type={v.type === "date" ? "date" : "text"}
                    value={values[v.key] ?? ""}
                    onChange={(e) => set(v.key, e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-[13px] text-foreground focus:border-accent focus:outline-none"
                  />
                )}
              </label>
            ))}
          </div>

          <label className="mt-5 block">
            <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-foreground/80">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Instructions IA (optionnel)
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Ex : ton plus ferme, ajouter une référence à l'article L1232-6 du Code du travail…"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </label>
        </form>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-background/40 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-[13px] font-medium text-foreground transition hover:bg-secondary"
          >
            Annuler
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Générer
          </button>
        </footer>
      </div>
    </div>
  );
}
