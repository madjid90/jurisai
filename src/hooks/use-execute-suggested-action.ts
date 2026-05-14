// useExecuteSuggestedAction — hook partagé pour exécuter une action suggérée
// par l'agent depuis n'importe quelle page (chat, agent 360, mes-demandes…).
//
// Centralise :
//   1. la normalisation `AgentRunSuggestedAction` -> `SuggestedActionInput`
//      attendu par le server fn `executeSuggestedAction` ;
//   2. l'inférence du `dossier_id` quand la run est rattachée à un dossier
//      (utilisé comme valeur par défaut pour les actions qui en demandent un) ;
//   3. la gestion uniforme du toast + redirection (router.navigate) ;
//   4. le blocage (`requires_validation`) renvoyé par le serveur (P0.4).
//
// Les pages branchent simplement :
//   const handleAction = useExecuteSuggestedAction({ run, onChanged });
//   <ResultRenderer onSuggestedAction={handleAction} ... />

import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { executeSuggestedAction } from "@/server/agent-actions.functions";
import type {
  AgentRun,
  AgentRunSuggestedAction,
} from "@/components/agent/ResultRenderer";

export type UseExecuteSuggestedActionOptions = {
  run?: AgentRun | null;
  /** Callback after a successful action (e.g. reload a list / invalidate cache). */
  onChanged?: () => void | Promise<void>;
};

export function useExecuteSuggestedAction({
  run,
  onChanged,
}: UseExecuteSuggestedActionOptions = {}) {
  const navigate = useNavigate();
  const exec = useServerFn(executeSuggestedAction);
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    async (action: AgentRunSuggestedAction) => {
      if (busy) return;
      const payload = buildPayload(action, run);
      if (!payload) {
        toast.error(
          "Action incomplète — informations manquantes pour l'exécuter automatiquement.",
        );
        return;
      }
      setBusy(true);
      try {
        const res = (await exec({ data: payload })) as {
          ok: boolean;
          redirect?: string;
          requires_validation?: boolean;
          reason?: string;
        };

        if (res.requires_validation) {
          toast.warning(
            res.reason ?? "Cette action nécessite une validation humaine.",
          );
        } else if (res.ok) {
          toast.success(successLabel(action));
        }

        await onChanged?.();

        if (res.redirect) {
          // navigate côté client — éviter le full reload
          navigate({ to: res.redirect });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action impossible");
      } finally {
        setBusy(false);
      }
    },
    [busy, exec, navigate, onChanged, run],
  );

  return Object.assign(handle, { busy });
}

// ---------------------------------------------------------------------------
// Normalisation : AgentRunSuggestedAction (front) -> SuggestedActionInput (zod)
// ---------------------------------------------------------------------------
function buildPayload(
  action: AgentRunSuggestedAction,
  run?: AgentRun | null,
): Record<string, unknown> | null {
  const type = action.type ?? action.kind;
  if (!type) return null;

  const p = (action.payload ?? {}) as Record<string, unknown>;
  const dossierId = (p.dossier_id as string | undefined) ?? run?.dossier_id ?? undefined;

  switch (type) {
    case "open_dossier":
      return p.dossier_id ? { type, dossier_id: p.dossier_id } : null;

    case "create_dossier":
      return {
        type,
        title: (p.title as string) ?? action.label,
        category: p.category,
        description: p.description,
        risk_level: p.risk_level,
      };

    case "link_document":
      if (!p.document_id || !dossierId) return null;
      return { type, document_id: p.document_id, dossier_id: dossierId };

    case "start_workflow":
      if (!p.definition_slug) return null;
      return {
        type,
        definition_slug: p.definition_slug,
        dossier_id: dossierId,
        title: p.title,
      };

    case "generate_document":
      if (!p.template_slug) return null;
      return {
        type,
        template_slug: p.template_slug,
        dossier_id: dossierId,
        context: p.context,
      };

    case "create_reminder":
      if (!p.due_date) return null;
      return {
        type,
        title: (p.title as string) ?? action.label,
        due_date: p.due_date,
        dossier_id: dossierId,
      };

    case "validate_action":
      if (!p.validation_id || typeof p.approved !== "boolean") return null;
      return {
        type,
        validation_id: p.validation_id,
        approved: p.approved,
        comment: p.comment,
      };

    case "assign_task":
      if (!p.assignee_id || !dossierId) return null;
      return {
        type,
        title: (p.title as string) ?? action.label,
        assignee_id: p.assignee_id,
        dossier_id: dossierId,
        due_date: p.due_date,
      };

    case "send_notification":
      if (!p.user_id) return null;
      return {
        type,
        user_id: p.user_id,
        title: (p.title as string) ?? action.label,
        body: p.body,
        link: p.link,
        kind: (p.kind as string) ?? "action_requise",
      };

    default:
      return null;
  }
}

function successLabel(action: AgentRunSuggestedAction): string {
  const t = action.type ?? action.kind;
  switch (t) {
    case "open_dossier":
      return "Dossier ouvert";
    case "create_dossier":
      return "Dossier créé";
    case "link_document":
      return "Document rattaché";
    case "start_workflow":
      return "Procédure lancée";
    case "generate_document":
      return "Génération démarrée";
    case "create_reminder":
      return "Rappel créé";
    case "validate_action":
      return "Validation enregistrée";
    case "assign_task":
      return "Tâche assignée";
    case "send_notification":
      return "Notification envoyée";
    default:
      return "Action exécutée";
  }
}
