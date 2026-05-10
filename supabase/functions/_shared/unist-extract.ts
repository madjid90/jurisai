// ============================================================================
// _shared/unist-extract.ts
// Extraction propre de texte depuis arbres unist SocialGouv (kali-data, legi-data, fiches).
// ============================================================================

export interface UnistNode {
  type: string;
  data?: {
    id?: string;
    cid?: string;
    num?: string;
    title?: string;
    content?: string;
    texte?: string;
    contenu?: string;
    etat?: string;
    dateDebut?: string;
    dateFin?: string;
    nature?: string;
    [key: string]: unknown;
  };
  children?: UnistNode[];
}

export interface ExtractedArticle {
  externalId: string;
  cid: string | null;
  num: string | null;
  title: string | null;
  sectionPath: string[];
  content: string;
  etat: string | null;
  dateDebut: string | null;
  dateFin: string | null;
  depth: number;
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?ul[^>]*>/gi, "\n")
    .replace(/<\/?ol[^>]*>/gi, "\n")
    .replace(/<h\d[^>]*>/gi, "\n## ")
    .replace(/<\/h\d>/gi, "\n")
    .replace(/<strong[^>]*>|<b[^>]*>/gi, "**")
    .replace(/<\/strong>|<\/b>/gi, "**")
    .replace(/<em[^>]*>|<i[^>]*>/gi, "*")
    .replace(/<\/em>|<\/i>/gi, "*")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&#0?(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractRawText(node: UnistNode): string {
  const data = node.data ?? {};
  if (typeof data.content === "string" && data.content.trim()) return data.content;
  if (typeof data.texte === "string" && data.texte.trim()) return data.texte;
  if (typeof data.contenu === "string" && data.contenu.trim()) return data.contenu;

  if (!node.children?.length) return "";

  const parts: string[] = [];
  for (const child of node.children) {
    if (child.type === "text" || child.type === "node" || child.type === "paragraph") {
      const t = (child.data?.content as string)
        ?? (child.data?.texte as string)
        ?? (child.data?.contenu as string)
        ?? "";
      if (t) parts.push(t);
    } else if (child.children?.length) {
      for (const grandchild of child.children) {
        const t = (grandchild.data?.content as string)
          ?? (grandchild.data?.texte as string)
          ?? "";
        if (t) parts.push(t);
      }
    }
  }
  return parts.join("\n\n");
}

export function* walkArticles(
  node: UnistNode,
  sectionPath: string[] = [],
  depth = 0,
): Generator<ExtractedArticle> {
  if (!node) return;

  if (node.type === "article") {
    const data = node.data ?? {};
    const rawContent = extractRawText(node);
    const cleanContent = stripHtml(rawContent);

    if (cleanContent.length >= 30) {
      yield {
        externalId: (data.id as string) ?? (data.cid as string) ?? `article-${Math.random()}`,
        cid: (data.cid as string) ?? null,
        num: (data.num as string) ?? null,
        title: (data.title as string) ?? null,
        sectionPath: [...sectionPath],
        content: cleanContent,
        etat: (data.etat as string) ?? null,
        dateDebut: (data.dateDebut as string)?.slice(0, 10) ?? null,
        dateFin: (data.dateFin as string)?.slice(0, 10) ?? null,
        depth,
      };
    }
    return;
  }

  if (node.children) {
    const sectionTitle = node.data?.title as string | undefined;
    const isHierarchical = ["section", "livre", "titre", "chapitre", "partie"].includes(node.type);
    const newPath = isHierarchical && sectionTitle
      ? [...sectionPath, sectionTitle]
      : sectionPath;

    for (const child of node.children) {
      yield* walkArticles(child, newPath, depth + 1);
    }
  }
}

export function buildArticleContent(art: ExtractedArticle, codeOrCcTitle?: string): string {
  const lines: string[] = [];
  const fullPath: string[] = [];
  if (codeOrCcTitle) fullPath.push(codeOrCcTitle);
  fullPath.push(...art.sectionPath);

  if (fullPath.length > 0) {
    lines.push(`**Localisation** : ${fullPath.join(" > ")}`);
  }

  if (art.num) {
    lines.push(`# Article ${art.num}`);
  } else if (art.title) {
    lines.push(`# ${art.title}`);
  } else {
    lines.push("# Disposition");
  }

  const meta: string[] = [];
  if (art.etat) {
    const etatLabel = art.etat === "VIGUEUR" ? "✅ En vigueur"
      : art.etat === "VIGUEUR_ETEN" ? "✅ En vigueur (étendu)"
      : art.etat === "ABROGE" ? "❌ Abrogé"
      : art.etat === "MODIFIE" ? "📝 Modifié"
      : `État: ${art.etat}`;
    meta.push(etatLabel);
  }
  if (art.dateDebut) meta.push(`Effet : ${art.dateDebut}`);
  if (art.dateFin) meta.push(`Fin : ${art.dateFin}`);
  if (meta.length) lines.push(`*${meta.join(" · ")}*`);

  lines.push("");
  lines.push(art.content);
  return lines.join("\n");
}

export function extractAllArticles(
  root: UnistNode,
  options: { keepAbrogated?: boolean; minContentLength?: number } = {},
): ExtractedArticle[] {
  const { keepAbrogated = false, minContentLength = 30 } = options;
  const articles: ExtractedArticle[] = [];
  for (const art of walkArticles(root)) {
    if (!keepAbrogated && art.etat === "ABROGE") continue;
    if (art.content.length < minContentLength) continue;
    articles.push(art);
  }
  return articles;
}

export function getExtractionStats(articles: ExtractedArticle[]) {
  return {
    total: articles.length,
    byEtat: articles.reduce((acc, a) => {
      const k = a.etat ?? "UNKNOWN";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    avgContentLength: Math.round(
      articles.reduce((sum, a) => sum + a.content.length, 0) / Math.max(1, articles.length),
    ),
    maxDepth: Math.max(...articles.map(a => a.depth), 0),
    withSectionPath: articles.filter(a => a.sectionPath.length > 0).length,
  };
}
