import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  Info,
  Link2,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
type PipelineResult = {
  documentId: string;
  entitiesCount: number;
  autoLinked: string[];
  suggested: string[];
  indexedDossiers: string[];
  skippedReason?: string;
};

export type DocumentAgentResult = {
  document_id: string;
  filename: string;
  text_length: number;
  text_preview: string;
  pipeline: PipelineResult | null;
};

type Props = {
  result: DocumentAgentResult;
  onClose?: () => void;
  onAsk?: (prompt: string) => void;
};

/**
 * Carte résultat affichée après l'ingestion d'un document depuis la home.
 * Affiche : aperçu OCR, dossiers auto-liés, suggestions, entités, actions rapides.
 */
export function DocumentResultCard({ result, onClose, onAsk }: Props) {
  const p = result.pipeline;
  const autoLinked = p?.autoLinked ?? [];
  const suggested = p?.suggested ?? [];
  const entitiesCount = p?.entitiesCount ?? 0;

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-card/80 p-5 shadow-[var(--shadow-card)]">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft">
            <ScanLine className="h-4 w-4 text-accent" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-foreground">
              {result.filename}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {result.text_length.toLocaleString("fr-FR")} caractères extraits ·{" "}
              {entitiesCount} entité{entitiesCount > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Liens auto */}
      {autoLinked.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Document rattaché à {autoLinked.length} dossier
            {autoLinked.length > 1 ? "s" : ""}
          </p>
          <ul className="flex flex-wrap gap-2">
            {autoLinked.map((id) => (
              <li key={id}>
                <Link
                  to="/dossiers/$id"
                  params={{ id }}
                  className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-secondary"
                >
                  <FolderOpen className="h-3 w-3" />
                  Voir le dossier
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions à valider */}
      {suggested.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-400">
            <Link2 className="h-3.5 w-3.5" />
            {suggested.length} liaison
            {suggested.length > 1 ? "s" : ""} à valider
          </p>
          <Link
            to="/links"
            className="text-[12px] text-accent hover:underline"
          >
            Ouvrir l'écran de validation →
          </Link>
        </div>
      )}

      {/* Aperçu texte */}
      {result.text_preview && (
        <details className="group rounded-xl border border-border bg-background/40 p-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Aperçu du contenu extrait
          </summary>
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
            {result.text_preview}
          </pre>
        </details>
      )}

      {p?.skippedReason && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 p-3 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Pipeline non appliqué : {p.skippedReason}</span>
        </div>
      )}

      {/* Actions rapides */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          to="/analyses/$id"
          params={{ id: result.document_id }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-95"
        >
          <FileText className="h-3.5 w-3.5" />
          Voir l'analyse complète
        </Link>
        {onAsk && (
          <>
            <button
              type="button"
              onClick={() => onAsk(`Résume ce document (id: ${result.document_id}) en 5 points et identifie les risques majeurs.`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-secondary"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Résumer & identifier les risques
            </button>
            <button
              type="button"
              onClick={() => onAsk(`Analyse les clauses du document (id: ${result.document_id}) et signale les points sensibles ou manquants.`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-secondary"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Analyser les clauses
            </button>
          </>
        )}
      </div>
    </section>
  );
}
