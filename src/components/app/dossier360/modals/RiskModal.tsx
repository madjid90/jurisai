// G6 — RiskModal extrait de Dossier360Tabs.
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createRisk } from "@/lib/server-fns/dossier360.functions";
import { Input, ModalShell, SubmitRow } from "../shared";
import type { Risk } from "../types";

export function RiskModal({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    severity: "medium" as Risk["severity"],
    category: "general",
    description: "",
    legalBasis: "",
    mitigation: "",
  });
  const createFn = useServerFn(createRisk);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          title: form.title,
          severity: form.severity,
          category: form.category || undefined,
          description: form.description || undefined,
          legalBasis: form.legalBasis || undefined,
          mitigation: form.mitigation || undefined,
        },
      });
      toast.success("Risque enregistré");
      onSaved();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Identifier un risque" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Intitulé">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="input-base" />
        </Input>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Gravité">
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Risk["severity"] })} className="input-base">
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
              <option value="critical">Critique</option>
            </select>
          </Input>
          <Input label="Catégorie">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-base" placeholder="rh, commercial, rgpd…" />
          </Input>
        </div>
        <Input label="Description">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="input-base" />
        </Input>
        <Input label="Base légale (article, source)">
          <input value={form.legalBasis} onChange={(e) => setForm({ ...form, legalBasis: e.target.value })} className="input-base" placeholder="Ex : Art. L1234-1 Code du travail" />
        </Input>
        <Input label="Mesure de mitigation envisagée">
          <textarea value={form.mitigation} onChange={(e) => setForm({ ...form, mitigation: e.target.value })} rows={2} className="input-base" />
        </Input>
        <SubmitRow busy={busy} onClose={onClose} label="Enregistrer le risque" />
      </form>
    </ModalShell>
  );
}
