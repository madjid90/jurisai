// G6 — ValidationModal extrait de Dossier360Tabs.
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { requestValidation } from "@/lib/server-fns/dossier360.functions";
import { Input, ModalShell, SubmitRow } from "../shared";

export function ValidationModal({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ subjectType: "", comment: "" });
  const createFn = useServerFn(requestValidation);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.subjectType.trim()) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          subjectType: form.subjectType,
          comment: form.comment || undefined,
        },
      });
      toast.success("Validation demandée");
      onSaved();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Demander une validation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Objet de la validation">
          <input value={form.subjectType} onChange={(e) => setForm({ ...form, subjectType: e.target.value })} required className="input-base" placeholder="Ex : envoi lettre licenciement, signature contrat…" />
        </Input>
        <Input label="Commentaire pour le validateur">
          <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={3} className="input-base" />
        </Input>
        <p className="text-[11px] text-muted-foreground">
          La demande sera assignée automatiquement à un administrateur du cabinet.
        </p>
        <SubmitRow busy={busy} onClose={onClose} label="Envoyer la demande" />
      </form>
    </ModalShell>
  );
}
