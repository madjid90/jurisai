import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { runOcrDocument } from "@/lib/server-fns/ocr.functions";
import { AppShell } from "@/components/app/AppShell";
import { Loader2, UploadCloud, ScanLine, FileText, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/scan")({
  head: () => ({ meta: [{ title: "OCR · JurisAI" }] }),
  component: ScanPage,
});

function ScanPage() {
  const { user } = useAuth();
  const ocr = useServerFn(runOcrDocument);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ text: string; length: number } | null>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setResult(null);
  }

  async function handleSubmit() {
    if (!file || !user) return;
    setBusy(true);
    setResult(null);
    try {
      setProgress("Préparation…");
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      const tenantId = profile?.tenant_id;
      if (!tenantId) throw new Error("Aucun tenant");

      setProgress("Upload du fichier…");
      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const path = `${tenantId}/${user.id}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("dossier-files").upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw new Error(upErr.message);

      setProgress("Analyse OCR en cours… (jusqu'à 30s)");
      const r = await ocr({
        data: {
          storage_path: path,
          filename: file.name,
          file_type: file.type || "application/octet-stream",
        },
      });
      setResult({ text: r.text, length: r.length });
      toast.success(`Analyse terminée — ${r.length} caractères extraits`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur OCR");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <AppShell>
      <div className="space-y-8 px-6 py-8 lg:px-10">
        {/* Header */}
        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
            <ScanLine className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wider text-accent">
              Analyse
            </p>
            <h1 className="mt-1 text-[28px] font-bold tracking-tight text-foreground">
              OCR & analyse de documents
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Uploadez un PDF ou une image — l'IA extrait le texte et le classifie automatiquement.
            </p>
          </div>
        </header>

        {/* Dropzone */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (busy) return;
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-2xl border-2 border-dashed bg-background p-10 text-center transition ${
            dragOver
              ? "border-accent bg-accent/5"
              : "border-border hover:border-accent/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={busy}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />

          {!file ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                <UploadCloud className="h-7 w-7 text-accent" />
              </div>
              <p className="mt-4 text-[15px] font-semibold text-foreground">
                Glissez votre fichier ici
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                PDF, PNG, JPEG ou WebP — jusqu'à 15 Mo
              </p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90"
              >
                <UploadCloud className="h-4 w-4" />
                Choisir un fichier
              </button>
            </>
          ) : (
            <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-left">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background">
                <FileText className="h-5 w-5 text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-foreground">
                  {file.name}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} Ko
                </p>
              </div>
              {!busy && (
                <button
                  onClick={() => setFile(null)}
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Retirer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {file && (
            <div className="mt-5">
              <button
                onClick={handleSubmit}
                disabled={busy}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {progress}
                  </>
                ) : (
                  <>
                    <ScanLine className="h-4 w-4" />
                    Lancer l'analyse
                  </>
                )}
              </button>
            </div>
          )}
        </section>

        {/* Result */}
        {result && (
          <section className="rounded-2xl border border-border bg-background shadow-sm">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold text-foreground">
                  Texte extrait
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  {result.length.toLocaleString("fr-FR")} caractères
                </p>
              </div>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(result.text);
                  toast.success("Copié");
                }}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-[12.5px] font-medium text-foreground transition hover:bg-secondary"
              >
                Copier
              </button>
            </header>
            <pre className="max-h-[600px] overflow-y-auto whitespace-pre-wrap p-5 text-[13px] leading-relaxed text-foreground">
              {result.text}
            </pre>
          </section>
        )}
      </div>
    </AppShell>
  );
}
