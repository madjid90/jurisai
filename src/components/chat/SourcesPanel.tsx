import { ExternalLink, BookMarked } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type CitationSource = {
  n: number;
  chunk_id: string;
  source_id: string;
  title: string;
  reference: string | null;
  url: string | null;
  type: string;
  heading: string | null;
  excerpt: string;
};

const TYPE_LABELS: Record<string, string> = {
  code_article: "Code",
  jurisprudence: "Jurisprudence",
  convention: "Conv. coll.",
  bofip: "BOFiP",
  manual: "Source",
};

export function SourcesPanel({
  sources,
  referenced,
}: {
  sources: CitationSource[];
  referenced: Set<number>;
}) {
  if (sources.length === 0) return null;
  // Show only sources actually referenced if we have any, else show all top results
  const visible =
    referenced.size > 0 ? sources.filter((s) => referenced.has(s.n)) : sources.slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-border/60 bg-secondary/30 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BookMarked className="h-3 w-3" />
        Sources officielles ({visible.length})
      </div>
      <ul className="space-y-2">
        {visible.map((s) => (
          <li
            key={s.chunk_id}
            className="rounded-xl border border-border/40 bg-background/60 p-2.5 text-[12px]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                  [{s.n}]
                </Badge>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {TYPE_LABELS[s.type] ?? s.type}
                </Badge>
              </div>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                  title="Ouvrir la source officielle"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="mt-1 font-medium text-foreground">
              {s.reference ? `${s.reference} — ` : ""}
              {s.title}
            </div>
            {s.heading && <div className="text-[11px] text-muted-foreground">{s.heading}</div>}
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
              {s.excerpt}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Extract referenced [source:N] numbers from an answer. */
export function extractReferenced(text: string): Set<number> {
  const set = new Set<number>();
  const re = /\[source:(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    set.add(parseInt(m[1], 10));
  }
  return set;
}

/** Replace [source:N] tokens with clickable superscript badges (returns React-friendly string with markers). */
export function renderCitationsInline(text: string, sources: CitationSource[]): string {
  if (sources.length === 0) return text;
  return text.replace(/\[source:(\d+)\]/g, (_match, n) => {
    const idx = parseInt(n, 10);
    const s = sources.find((x) => x.n === idx);
    if (!s) return "";
    // Render as a markdown link: [^N](#source-N) — handled by ReactMarkdown
    if (s.url) return ` [\\[${idx}\\]](${s.url})`;
    return ` \\[${idx}\\]`;
  });
}
