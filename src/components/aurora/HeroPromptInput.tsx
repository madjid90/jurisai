import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Paperclip, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type HeroPromptInputProps = {
  placeholder?: string;
  onSubmit: (text: string, files: File[]) => void | Promise<void>;
  loading?: boolean;
  /** Accepte les fichiers en upload (drag/drop + bouton). */
  acceptUpload?: boolean;
  className?: string;
};

/**
 * Champ de saisie central de la home AI.
 * - Multiline auto-grow
 * - Cmd/Ctrl+Enter ou bouton flèche pour envoyer
 * - Trombone + drag&drop pour joindre des fichiers
 */
export function HeroPromptInput({
  placeholder = "Que souhaitez-vous faire aujourd'hui ?",
  onSubmit,
  loading = false,
  acceptUpload = true,
  className,
}: HeroPromptInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !files.length) return;
    if (loading) return;
    await onSubmit(trimmed, files);
    setText("");
    setFiles([]);
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!acceptUpload) return;
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={(e) => {
        if (!acceptUpload) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "relative w-full rounded-3xl border bg-card/80 backdrop-blur-xl",
        "shadow-aurora transition-all",
        dragOver && "ring-2 ring-accent ring-offset-2 ring-offset-background",
        className,
      )}
    >
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autoGrow();
        }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        rows={1}
        className={cn(
          "w-full resize-none bg-transparent",
          "px-6 pt-5 pb-3 text-base leading-relaxed",
          "text-foreground placeholder:text-muted-foreground",
          "focus:outline-none",
        )}
      />

      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-6 pb-2">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs text-accent-soft-foreground"
            >
              <Paperclip className="h-3 w-3" />
              {f.name}
              <button
                type="button"
                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                className="ml-1 text-accent-soft-foreground/70 hover:text-accent-soft-foreground"
                aria-label="Retirer"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between px-3 pb-3">
        <div className="flex items-center gap-1">
          {acceptUpload ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Joindre un fichier"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length) setFiles((p) => [...p, ...list]);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            ⌘/Ctrl + Entrée pour envoyer
          </span>
        </div>

        <button
          type="submit"
          disabled={loading || (!text.trim() && !files.length)}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full",
            "bg-aurora text-white shadow-glow",
            "transition-all hover:scale-105 active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100",
          )}
          aria-label="Envoyer"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
    </form>
  );
}
