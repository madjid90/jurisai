import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runLegalAgent } from "@/server/agent.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/agent")({
  component: AgentPage,
});

function AgentPage() {
  const run = useServerFn(runLegalAgent);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runLegalAgent>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!message.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await run({ data: { message } });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-primary" />
          Agent IA juridique
        </h1>
        <p className="text-muted-foreground mt-2">
          L'agent peut consulter les sources légales, lister vos dossiers et créer des tâches/échéances.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Textarea
            placeholder="Ex : Cherche les règles sur la période d'essai d'un cadre, puis crée une tâche dans le dossier Dupont pour préparer le contrat."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            disabled={loading}
          />
          <Button onClick={submit} disabled={loading || !message.trim()}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Réflexion…</> : "Lancer l'agent"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card>
            <CardHeader><CardTitle>Réponse</CardTitle></CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                {result.answer}
              </div>
            </CardContent>
          </Card>

          {result.trace.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" /> Outils utilisés ({result.trace.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.trace.map((t, i) => (
                  <div key={i} className="border rounded-md p-3 text-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">{t.tool}</Badge>
                    </div>
                    <pre className="text-xs overflow-x-auto bg-muted p-2 rounded">
                      {JSON.stringify(t.args, null, 2)}
                    </pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {result.sources.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Sources ({result.sources.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {result.sources.map((s) => (
                  <div key={s.n} className="text-sm border-l-2 border-primary pl-3">
                    <Badge variant="outline" className="mr-2">[{s.n}]</Badge>
                    <span className="font-medium">{s.title}</span>
                    {s.ref && <span className="text-muted-foreground"> · {s.ref}</span>}
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">
                        ↗ source
                      </a>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
