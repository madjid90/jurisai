import { createFileRoute } from "@tanstack/react-router";
import { useConfirm } from "@/components/shared/ConfirmProvider";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  Loader2,
  Plus,
  Search,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  listLegalSources,
  toggleLegalSourceActive,
  deleteLegalSource,
  ingestLegalUrl,
  type LegalSourceRow,
} from "@/server/legal-sources.functions";

export const Route = createFileRoute("/_authenticated/admin/legal-sources")({
  head: () => ({ meta: [{ title: "Sources légales · JurisAI" }] }),
  component: LegalSourcesAdminPage,
});

const SOURCE_TYPES = [
  { value: "code_article", label: "Code (article)" },
  { value: "jurisprudence", label: "Jurisprudence" },
  { value: "convention", label: "Convention collective" },
  { value: "bofip", label: "BOFiP" },
  { value: "circulaire", label: "Circulaire" },
  { value: "manual", label: "Source manuelle" },
];

function LegalSourcesAdminPage() {
  const confirmAsync = useConfirm();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);

  const sourcesQuery = useQuery({
    queryKey: ["admin", "legal-sources", { search, typeFilter }],
    queryFn: () =>
      listLegalSources({
        data: { search: search || undefined, type: typeFilter || undefined },
      }),
    retry: false,
  });

  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; is_active: boolean }) =>
      toggleLegalSourceActive({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "legal-sources"] });
      toast.success("Statut mis à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLegalSource({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "legal-sources"] });
      toast.success("Source supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (
    sourcesQuery.error &&
    sourcesQuery.error.message.includes("super-administrateurs")
  ) {
    return (
      <AppShell>
        <div className="glass-panel rounded-3xl p-8 text-center">
          <h1 className="text-2xl font-semibold">Accès refusé</h1>
          <p className="mt-2 text-muted-foreground">
            Réservé aux super-administrateurs.
          </p>
        </div>
      </AppShell>
    );
  }

  const sources = sourcesQuery.data?.sources ?? [];

  return (
    <AppShell>
      <div className="space-y-6 overflow-y-auto pr-1">
        <header className="glass-panel flex items-center justify-between rounded-3xl p-6">
          <div className="flex items-center gap-3">
            <BookMarked className="h-6 w-6 text-accent" />
            <div>
              <h1 className="text-2xl font-semibold">Sources légales</h1>
              <p className="text-sm text-muted-foreground">
                Catalogue officiel utilisé par le RAG
              </p>
            </div>
          </div>
          <Button onClick={() => setImportOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Importer une URL
          </Button>
        </header>

        {/* Filters */}
        <Card className="glass-panel border-0">
          <CardContent className="flex gap-3 p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par titre…"
                className="pl-9"
              />
            </div>
            <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Tous types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous types</SelectItem>
                {SOURCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="glass-panel border-0">
          <CardHeader>
            <CardTitle className="text-base">
              {sourcesQuery.isLoading
                ? "Chargement…"
                : `${sources.length} source(s)`}
            </CardTitle>
            <CardDescription>
              Désactivez une source pour l'exclure du RAG sans la supprimer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sourcesQuery.isLoading ? (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
              </div>
            ) : sources.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Aucune source. Lancez un connecteur ou importez une URL.
              </div>
            ) : (
              <div className="space-y-2">
                {sources.map((s) => (
                  <SourceRow
                    key={s.id}
                    source={s}
                    onToggle={(active) =>
                      toggleMut.mutate({ id: s.id, is_active: active })
                    }
                    onDelete={async () => {
                      if (await confirmAsync(`Supprimer définitivement « ${s.title} » ?`)) {
                        deleteMut.mutate(s.id);
                      }
                    }}
                    busy={
                      (toggleMut.isPending && toggleMut.variables?.id === s.id) ||
                      (deleteMut.isPending && deleteMut.variables === s.id)
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onDone={() => qc.invalidateQueries({ queryKey: ["admin", "legal-sources"] })}
        />
      </div>
    </AppShell>
  );
}

function SourceRow({
  source,
  onToggle,
  onDelete,
  busy,
}: {
  source: LegalSourceRow;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/30 bg-background/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{source.title}</span>
          {source.reference_code && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {source.reference_code}
            </Badge>
          )}
          {!source.is_active && (
            <Badge variant="secondary" className="text-[10px]">
              désactivée
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {source.source_type}
          </Badge>
          {source.connector && <span>via {source.connector}</span>}
          {source.idcc && <span>· IDCC {source.idcc}</span>}
          <span>
            ·{" "}
            {new Date(source.created_at).toLocaleDateString("fr-FR")}
          </span>
        </div>
      </div>

      {source.official_url && (
        <a
          href={source.official_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-accent"
          title="Source officielle"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onToggle(!source.is_active)}
        title={source.is_active ? "Désactiver" : "Réactiver"}
      >
        {source.is_active ? (
          <Eye className="h-4 w-4" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onDelete}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [reference, setReference] = useState("");
  const [idcc, setIdcc] = useState("");

  const ingestMut = useMutation({
    mutationFn: () =>
      ingestLegalUrl({
        data: {
          title,
          source_type: sourceType,
          url: url || undefined,
          raw_text: rawText || undefined,
          reference_code: reference || undefined,
          official_url: url || undefined,
          idcc: idcc || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success("Source ingérée", {
        description: `${(res.result as { chunks_created?: number })?.chunks_created ?? 0} chunks créés`,
      });
      setTitle("");
      setUrl("");
      setRawText("");
      setReference("");
      setIdcc("");
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) =>
      toast.error("Échec ingestion", { description: e.message.slice(0, 200) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importer une source légale</DialogTitle>
          <DialogDescription>
            Fournir une URL publique (HTML, texte) ou coller du contenu brut.
            Le contenu sera nettoyé, découpé, vectorisé et indexé pour le RAG.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Titre *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Article L1234-1 du Code du travail"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type *</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Référence</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="L1234-1"
              />
            </div>
          </div>
          <div>
            <Label>URL publique</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.legifrance.gouv.fr/..."
            />
          </div>
          <div>
            <Label>Ou texte brut</Label>
            <Textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={5}
              placeholder="Coller le contenu textuel ici…"
            />
          </div>
          <div>
            <Label>IDCC (optionnel)</Label>
            <Input
              value={idcc}
              onChange={(e) => setIdcc(e.target.value)}
              placeholder="1486"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => ingestMut.mutate()}
            disabled={
              ingestMut.isPending || !title || (!url && !rawText)
            }
          >
            {ingestMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Ingérer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
