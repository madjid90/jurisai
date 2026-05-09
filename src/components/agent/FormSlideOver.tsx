// FormSlideOver — panneau latéral droit pour formulaires (procedure_validation,
// edit_extracted_data, create_dossier, missing_information, workflow_confirmation).
// Remplace les popups agressifs : ouvert uniquement au clic, fermeture fluide,
// sauvegarde draft auto en localStorage.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FormSlideOverType =
  | "procedure_validation"
  | "edit_extracted_data"
  | "create_dossier"
  | "missing_information"
  | "workflow_confirmation";

export type FormSlideOverPayload = {
  type: FormSlideOverType;
  title?: string;
  data?: Record<string, unknown>;
  render: (api: {
    data: Record<string, unknown>;
    setData: (next: Record<string, unknown>) => void;
    close: () => void;
  }) => ReactNode;
  onClose?: () => void;
};

type Ctx = {
  openForm: (p: FormSlideOverPayload) => void;
  closeForm: () => void;
};

const FormSlideOverContext = createContext<Ctx | null>(null);

export function useFormSlideOver(): Ctx {
  const ctx = useContext(FormSlideOverContext);
  if (!ctx) throw new Error("useFormSlideOver must be used within <FormSlideOverProvider>");
  return ctx;
}

const draftKey = (type: string, id: string | null | undefined) =>
  `jurisai.formdraft.${type}.${id ?? "default"}`;

export function FormSlideOverProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<FormSlideOverPayload | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});

  // Hydrate draft on open
  useEffect(() => {
    if (!payload) return;
    const id = (payload.data?.id as string | undefined) ?? null;
    let initial = payload.data ?? {};
    try {
      const raw = window.localStorage.getItem(draftKey(payload.type, id));
      if (raw) initial = { ...initial, ...JSON.parse(raw) };
    } catch {/* noop */}
    setData(initial);
  }, [payload]);

  // Persist draft on change
  useEffect(() => {
    if (!payload) return;
    const id = (payload.data?.id as string | undefined) ?? null;
    try {
      window.localStorage.setItem(draftKey(payload.type, id), JSON.stringify(data));
    } catch {/* noop */}
  }, [data, payload]);

  const openForm = useCallback((p: FormSlideOverPayload) => setPayload(p), []);
  const closeForm = useCallback(() => {
    payload?.onClose?.();
    setPayload(null);
    setData({});
  }, [payload]);

  // ESC closes
  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payload, closeForm]);

  const open = !!payload;

  return (
    <FormSlideOverContext.Provider value={{ openForm, closeForm }}>
      {children}
      {/* Backdrop */}
      <div
        aria-hidden={!open}
        onClick={closeForm}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      {/* Slide panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {payload && (
          <div className="flex h-full flex-col">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-base font-semibold">{payload.title ?? "Compléter"}</h2>
              <button
                type="button"
                onClick={closeForm}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {payload.render({ data, setData, close: closeForm })}
            </div>
          </div>
        )}
      </aside>
    </FormSlideOverContext.Provider>
  );
}
