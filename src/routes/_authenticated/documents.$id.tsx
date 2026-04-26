import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Bold,
  CheckCircle2,
  Download,
  FileDown,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Save,
  Strikethrough,
  Undo2,
  Redo2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateDocument } from "@/server/documents.functions";
import { exportElementToPdf, exportHtmlAsDoc } from "@/lib/documents/export";

export const Route = createFileRoute("/_authenticated/documents/$id")({
  head: () => ({ meta: [{ title: "Éditeur · JurisAI" }] }),
  component: DocumentEditorPage,
});

function DocumentEditorPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const updateFn = useServerFn(updateDocument);

  const [title, setTitle] = useState("Document");
  const [status, setStatus] = useState<"draft" | "final">("draft");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "doc" | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[600px] text-foreground [&>*]:my-3 [&_h2]:text-[20px] [&_h2]:font-bold [&_h3]:text-[16px] [&_h3]:font-semibold [&_p]:leading-relaxed",
      },
    },
  });

  // Load document
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("title, content, status")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        toast.error("Document introuvable");
        void navigate({ to: "/documents" });
        return;
      }
      setTitle(data.title);
      setStatus((data.status as "draft" | "final") ?? "draft");
      editor?.commands.setContent(data.content || "<p></p>");
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editor]);

  const onSave = async (nextStatus?: "draft" | "final") => {
    if (!editor) return;
    setSaving(true);
    try {
      await updateFn({
        data: {
          id,
          title,
          content: editor.getHTML(),
          status: nextStatus ?? status,
        },
      });
      if (nextStatus) setStatus(nextStatus);
      toast.success(nextStatus === "final" ? "Document finalisé" : "Enregistré");
    } catch (err) {
      toast.error("Enregistrement impossible", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const onExportPdf = async () => {
    if (!printRef.current) return;
    setExporting("pdf");
    try {
      await exportElementToPdf(
        printRef.current,
        `${(title || "document").replace(/[^\w\s-]/g, "")}.pdf`,
      );
    } catch {
      toast.error("Export PDF impossible");
    } finally {
      setExporting(null);
    }
  };

  const onExportDoc = () => {
    if (!editor) return;
    setExporting("doc");
    try {
      exportHtmlAsDoc(
        editor.getHTML(),
        title,
        `${(title || "document").replace(/[^\w\s-]/g, "")}.doc`,
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Toolbar */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:px-8">
        <Link
          to="/documents"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Documents
        </Link>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="ml-2 min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[15px] font-semibold text-foreground focus:bg-secondary focus:outline-none"
          placeholder="Titre du document"
        />

        <div className="flex items-center gap-2">
          <span
            className={`hidden rounded-full px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider sm:inline-block ${
              status === "final"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}
          >
            {status === "final" ? "Finalisé" : "Brouillon"}
          </span>
          <button
            onClick={() => void onSave()}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Enregistrer
          </button>
          <button
            onClick={() => void onSave("final")}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Finaliser
          </button>
          <button
            onClick={() => void onExportPdf()}
            disabled={exporting !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
          >
            {exporting === "pdf" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            PDF
          </button>
          <button
            onClick={onExportDoc}
            disabled={exporting !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
          >
            <FileDown className="h-3.5 w-3.5" />
            Word
          </button>
        </div>
      </header>

      {/* Format toolbar */}
      {editor && (
        <div className="sticky top-[60px] z-10 flex flex-wrap items-center gap-1 border-b border-border bg-background/60 px-4 py-2 backdrop-blur lg:px-8">
          <FmtBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
            <Bold className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
            <Italic className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
            <Strikethrough className="h-3.5 w-3.5" />
          </FmtBtn>
          <Sep />
          <FmtBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
            <Heading2 className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
            <Heading3 className="h-3.5 w-3.5" />
          </FmtBtn>
          <Sep />
          <FmtBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
            <List className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
            <ListOrdered className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
            <Quote className="h-3.5 w-3.5" />
          </FmtBtn>
          <Sep />
          <FmtBtn onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 className="h-3.5 w-3.5" />
          </FmtBtn>
        </div>
      )}

      {/* Page surface */}
      <main className="flex-1 bg-secondary/30 px-4 py-8 lg:px-10">
        {loading ? (
          <div className="mx-auto h-[700px] w-full max-w-[800px] animate-pulse rounded-2xl border border-border bg-background" />
        ) : (
          <div
            ref={printRef}
            className="mx-auto w-full max-w-[800px] rounded-2xl border border-border bg-white px-12 py-16 text-black shadow-sm"
            style={{ minHeight: "1100px" }}
          >
            <EditorContent editor={editor} />
          </div>
        )}
      </main>
    </div>
  );
}

function FmtBtn({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground transition hover:bg-secondary ${
        active ? "bg-secondary" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-border" />;
}
