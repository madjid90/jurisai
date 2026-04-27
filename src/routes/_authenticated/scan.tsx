import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { runOcrDocument } from "@/server/ocr.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, ScanLine } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/scan")({
  head: () => ({ meta: [{ title: "OCR · JurisAI" }] }),
  component: ScanPage,
});

function ScanPage() {
  const { user } = useAuth();
  const ocr = useServerFn(runOcrDocument);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<{ text: string; length: number } | null>(null);

  async function handleSubmit() {
    if (!file || !user) return;
    setBusy(true);
    setResult(null);
    try {
      // 1. Look up tenant_id
      setProgress("Préparation…");
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      const tenantId = profile?.tenant_id;
      if (!tenantId) throw new Error("Aucun tenant");

      // 2. Upload to storage
      setProgress("Upload du fichier…");
      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const path = `${tenantId}/${user.id}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("dossier-files").upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw new Error(upErr.message);

      // 3. Trigger OCR
      setProgress("Analyse OCR en cours… (peut prendre 30s)");
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
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ScanLine className="h-7 w-7 text-primary" />
          OCR & analyse de documents
        </h1>
        <p className="text-muted-foreground mt-2">
          Uploade un PDF ou une image, l'IA en extrait le texte et le classifie automatiquement.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Nouveau document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <div className="text-sm text-muted-foreground">
              {file.name} — {(file.size / 1024).toFixed(0)} Ko
            </div>
          )}
          <Button onClick={handleSubmit} disabled={!file || busy}>
            {busy
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {progress}</>
              : "Lancer l'analyse"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Texte extrait ({result.length} caractères)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md max-h-[600px] overflow-y-auto">
              {result.text}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
