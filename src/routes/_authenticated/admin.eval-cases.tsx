// Admin : validation rapide des cas d'évaluation RAG.
// Permet de marquer chaque cas comme validé (utilisable pour l'eval LRE)
// ou rejeté (sera désactivé). Vue compacte pour aller vite.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ClipboardList, Search } from "lucide-react";
import { toast } from "sonner";
import {
  listEvalCases,
  validateEvalCase,
  rejectEvalCase,
} from "@/server/eval-cases.functions";

export const Route = createFileRoute("/_authenticated/admin/eval-cases")({
  head: () => ({ meta: [{ title: "Validation des cas d'éval · Admin · JurisAI" }] }),
  component: EvalCasesPage,
});

type EvalCase = {
  id: string;
  question: string;
  expected_sources: string[] | null;
  expected_answer_keywords: string[] | null;
  category: string;
  difficulty: string;
  idcc: string | null;
  active: boolean;
  validated: boolean;
  validated_at: string | null;
  rejection_reason: string | null;
};

function EvalCasesPage() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "validated" | "rejected">("pending");
  const [q, setQ] = useState("");

  const list = useServerFn(listEvalCases);
  const validate = useServerFn(validateEvalCase);
  const reject = useServerFn(rejectEvalCase);

  async function load() {
    setLoading(true);
    try {
      const d = (await list()) as EvalCase[];
      setCases(d);
    } catch (e) {
      toast.error("Chargement : " + (e instanceof Error ? e.message : "erreur"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleValidate(id: string) {
    setBusy(id);
    try {
      await validate({ data: { caseId: id } });
      toast.success("Cas validé.");
      setCases((cs) => cs.map((c) => c.id === id ? { ...c, validated: true, rejection_reason: null } : c));
    } catch (e) {
      toast.error("Validation : " + (e instanceof Error ? e.message : "erreur"));
    } finally { setBusy(null); }
  }

  async function handleReject(id: string) {
    const reason = window.prompt("Raison du rejet (optionnel) :", "Cas peu pertinent");
    if (reason === null) return;
    setBusy(id);
    try {
      await reject({ data: { caseId: id, reason } });
      toast.success("Cas rejeté et désactivé.");
      setCases((cs) => cs.map((c) => c.id === id ? { ...c, validated: false, active: false, rejection_reason: reason } : c));
    } catch (e) {
      toast.error("Rejet : " + (e instanceof Error ? e.message : "erreur"));
    } finally { setBusy(null); }
  }

  const filtered = cases.filter((c) => {
    if (filter === "pending" && (c.validated || !c.active)) return false;
    if (filter === "validated" && !c.validated) return false;
    if (filter === "rejected" && c.active) return false;
    if (q && !c.question.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all: cases.length,
    pending: cases.filter((c) => !c.validated && c.active).length,
    validated: cases.filter((c) => c.validated).length,
    rejected: cases.filter((c) => !c.active).length,
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-2">
        <header>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="h-4 w-4" /> Admin
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Validation des cas d'évaluation RAG</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Valide chaque cas en 1 clic. Les cas validés seront utilisés dans les métriques d'éval du moteur de raisonnement juridique (LRE).
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
          {(["pending", "validated", "rejected", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground/70 hover:bg-secondary/80"
              }`}
            >
              {f === "pending" ? "À valider" : f === "validated" ? "Validés" : f === "rejected" ? "Rejetés" : "Tous"}
              <span className="ml-1.5 text-xs opacity-75">({counts[f]})</span>
            </button>
          ))}
          <div className="ml-auto relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher dans les questions…"
              className="rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aucun cas dans cette catégorie.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((c) => (
              <li key={c.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">{c.category}</span>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${
                        c.difficulty === "easy" ? "bg-emerald-100 text-emerald-700" :
                        c.difficulty === "hard" ? "bg-red-100 text-red-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>{c.difficulty}</span>
                      {c.idcc && <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700">IDCC {c.idcc}</span>}
                      {c.validated && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Validé
                        </span>
                      )}
                      {!c.active && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                          <XCircle className="h-3 w-3" /> Rejeté
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{c.question}</p>
                    {c.expected_sources && c.expected_sources.length > 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">Sources attendues :</span> {c.expected_sources.join(", ")}
                      </p>
                    )}
                    {c.rejection_reason && (
                      <p className="mt-1 text-xs italic text-red-700">Raison rejet : {c.rejection_reason}</p>
                    )}
                  </div>
                  {!c.validated && c.active && (
                    <div className="flex flex-shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleReject(c.id)} disabled={busy === c.id}>
                        {busy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Rejeter"}
                      </Button>
                      <Button size="sm" onClick={() => handleValidate(c.id)} disabled={busy === c.id}
                        className="bg-gradient-to-br from-primary to-accent text-primary-foreground">
                        {busy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Valider"}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
