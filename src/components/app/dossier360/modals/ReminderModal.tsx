// G6 — ReminderModal extrait de Dossier360Tabs.
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createReminder } from "@/server/dossier360.functions";
import { Input, ModalShell, SubmitRow } from "../shared";

export function ReminderModal({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", remindAt: "" });
  const createFn = useServerFn(createReminder);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.remindAt) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          title: form.title,
          body: form.body || undefined,
          remindAt: new Date(form.remindAt).toISOString(),
        },
      });
      toast.success("Rappel programmé");
      onSaved();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Programmer un rappel" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Intitulé">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="input-base" />
        </Input>
        <Input label="Date et heure">
          <input type="datetime-local" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} required className="input-base" />
        </Input>
        <Input label="Note">
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={2} className="input-base" />
        </Input>
        <SubmitRow busy={busy} onClose={onClose} label="Programmer" />
      </form>
    </ModalShell>
  );
}
