// Smart hierarchical chunker for legal documents.
// Adapts splitting strategy by source_type:
//   - "code" / "loi" / "decret"  → split by Article X-XXX (legal articles)
//   - "jurisprudence"            → keep arrêt as 1-2 chunks (motifs / dispositif)
//   - "convention_collective"    → split by Article + Annexe
//   - default                    → fallback to paragraph chunker

export type SmartChunk = { heading: string | null; content: string };

const ART_RE = /(?=^Article\s+[A-Z]?[\d.\-]+(?:\s|:|$))/gm;
const ARRET_RE = /(?=^(?:Sur le moyen|PAR CES MOTIFS|Attendu que|MOTIFS DE LA DÉCISION))/gim;
const ANNEXE_RE = /(?=^(?:Article\s+[\d.\-]+|Annexe\s+[A-Z\d]+))/gm;

function packChunks(parts: string[], target: number, overlap: number): SmartChunk[] {
  const out: SmartChunk[] = [];
  let buf = "";
  let heading: string | null = null;

  const flush = () => {
    const t = buf.trim();
    if (t.length >= 80) out.push({ heading, content: t });
    buf = "";
  };

  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    // Capture leading "Article ..." as heading
    const m = p.match(/^(Article\s+[A-Z]?[\d.\-]+|Annexe\s+[A-Z\d]+|Sur le moyen[^\n]*|PAR CES MOTIFS)/i);
    const localHeading = m ? m[0].slice(0, 200) : null;

    if (buf.length + p.length + 2 > target && buf.length > 0) {
      flush();
      // overlap with tail of previous chunk
      if (out.length > 0 && overlap > 0) {
        buf = out[out.length - 1].content.slice(-overlap) + "\n\n";
      }
      heading = localHeading ?? heading;
    } else if (localHeading && !heading) {
      heading = localHeading;
    }

    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return out;
}

export function smartChunk(
  text: string,
  sourceType: string,
  opts: { targetChars?: number; overlapChars?: number } = {},
): SmartChunk[] {
  const target = opts.targetChars ?? 3200;
  const overlap = opts.overlapChars ?? 250;

  const t = sourceType.toLowerCase();
  let splitter: RegExp | null = null;
  let smaller = target;

  if (t.includes("code") || t.includes("loi") || t.includes("decret") || t.includes("legifrance")) {
    splitter = ART_RE;
    smaller = 2400; // articles plus courts → chunks plus serrés
  } else if (t.includes("juris") || t.includes("arret") || t.includes("judilibre")) {
    splitter = ARRET_RE;
    smaller = 4000; // garder le raisonnement complet
  } else if (t.includes("convention") || t.includes("kali") || t.includes("idcc")) {
    splitter = ANNEXE_RE;
    smaller = 2800;
  }

  if (splitter) {
    const parts = text.split(splitter).filter((p) => p.trim().length > 30);
    if (parts.length > 1) return packChunks(parts, smaller, overlap);
  }

  // Fallback: paragraph chunking
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return packChunks(paragraphs, target, overlap);
}
