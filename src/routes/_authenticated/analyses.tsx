import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { VirtualList } from "@/components/shared/VirtualList";
import {
  analyzeDocument,
  deleteAnalysis,
  listAnalyses,
} from "@/server/analysis.functions";

export const Route = createFileRoute("/_authenticated/analyses")({
  head: () => ({ meta: [{ title: "Analyses · JurisAI" }] }),
  component: AnalysesPage,
});

type AnalysisRow = {
  id: string;
  filename: string;
  file_type: "pdf" | "docx";
  file_size: number;
  status: "pending" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
};

function AnalysesPage() {
  const confirmAsync = useConfirm();
  const { user } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listAnalyses);
  const deleteFn = useServerFn(deleteAnalysis);
  const analyzeFn = useServerFn(analyzeDocument);

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetcher = useCallback(
    async ({ limit, offset }: { limit: number; offset: number }) => {
      const res = await listFn({ data: { limit, offset } });
      return {
        items: (res.analyses ?? []) as AnalysisRow[],
        hasMore: res.hasMore ?? false,
        total: res.total,
      };
    },
    [listFn],
  );

  const list = useInfiniteList<AnalysisRow>(fetcher, {
    pageSize: 30,
    enabled: !!user,
    deps: [user?.id],
  });

  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "pdf" && ext !== "docx") {
      toast.error("Format non supporté. Utilisez PDF ou DOCX.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Fichier trop volumineux (max 5 MB)");
      return;
    }

    setUploading(true);
    const toastId = toast.loading(`Analyse de ${file.name} en cours…`);

    try {
      // Encode en base64
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const b64 = btoa(binary);

      const res = await analyzeFn({
        data: {
          filename: file.name,
          file_type: ext as "pdf" | "docx",
          file_base64: b64,
        },
      });

      toast.success("Analyse terminée !", { id: toastId });
      void navigate({ to: "/analyses/$id", params: { id: res.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur d'analyse", { id: toastId });
      void refresh();
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmAsync("Supprimer cette analyse ?"))) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Analyse supprimée");
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-8 py-6">
          <h1 className="text-[22px] font-bold text-foreground">Analyse de documents</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Téléversez un contrat, une lettre RH ou un avenant. L'IA en extrait les points clés, les risques et les recommandations.
          </p>
        </div>

        {/* Upload zone */}
        <div className="px-8 pt-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file && !uploading) void handleFile(file);
            }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition",
              dragOver
                ? "border-accent bg-accent-soft"
                : "border-border hover:border-accent/50 hover:bg-secondary/50",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
              {uploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Upload className="h-7 w-7" />}
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-foreground">
              {uploading ? "Analyse en cours…" : "Glissez un document ou cliquez ici"}
            </h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              PDF ou DOCX · max 5 MB · texte natif uniquement (pas de scan)
            </p>
          </div>
        </div>

        {/* List */}
        <div className="px-8 py-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Historique ({items.length})
          </h2>
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : items.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
              Aucune analyse pour le moment.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {items.map((a) => (
                <AnalysisCard key={a.id} item={a} onDelete={() => handleDelete(a.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AnalysisCard({ item, onDelete }: { item: AnalysisRow; onDelete: () => void }) {
  const StatusIcon =
    item.status === "completed" ? CheckCircle2 : item.status === "failed" ? AlertCircle : Clock;
  const statusColor =
    item.status === "completed"
      ? "text-emerald-600 dark:text-emerald-400"
      : item.status === "failed"
        ? "text-destructive"
        : "text-amber-600 dark:text-amber-400";

  const content = (
    <div className="group flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 transition hover:border-accent/40">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-foreground">{item.filename}</p>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            {item.file_type}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {(item.file_size / 1024).toFixed(0)} KB ·{" "}
          {new Date(item.created_at).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {item.error_message && ` · ${item.error_message}`}
        </p>
      </div>
      <div className={cn("flex items-center gap-1.5 text-[12px] font-medium", statusColor)}>
        <StatusIcon className="h-4 w-4" />
        {item.status === "completed" ? "Analysé" : item.status === "failed" ? "Échec" : "En cours"}
      </div>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        className="rounded-lg p-2 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  return item.status === "completed" ? (
    <Link to="/analyses/$id" params={{ id: item.id }} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
