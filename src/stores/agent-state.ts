// agentState — store global Zustand pour suivre l'état courant de l'agent
// au sein de la session. Ne remplace pas les statuts persistés en base
// (agent_runs.status), mais permet à l'UI de coordonner spinners,
// badges, et de logger les transitions vers `agent_runs` / `server_errors`.

import { create } from "zustand";

export type AgentPhase =
  | "idle"
  | "thinking"
  | "processing"
  | "waiting_validation"
  | "completed"
  | "error";

type Transition = {
  at: number;
  phase: AgentPhase;
  runId?: string | null;
  note?: string;
};

type AgentStateStore = {
  phase: AgentPhase;
  runId: string | null;
  errorMessage: string | null;
  history: Transition[];
  setPhase: (phase: AgentPhase, opts?: { runId?: string | null; note?: string; errorMessage?: string }) => void;
  reset: () => void;
};

const MAX_HISTORY = 50;

export const useAgentState = create<AgentStateStore>((set) => ({
  phase: "idle",
  runId: null,
  errorMessage: null,
  history: [],
  setPhase: (phase, opts) =>
    set((s) => {
      const next: Transition = {
        at: Date.now(),
        phase,
        runId: opts?.runId ?? s.runId,
        note: opts?.note,
      };
      const history = [...s.history, next].slice(-MAX_HISTORY);
      // Observabilité minimale : trace dans la console pour debug navigateur.
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-console
        console.debug("[agentState]", phase, opts ?? {});
      }
      return {
        phase,
        runId: opts?.runId ?? s.runId,
        errorMessage: phase === "error" ? opts?.errorMessage ?? "Erreur inconnue" : null,
        history,
      };
    }),
  reset: () => set({ phase: "idle", runId: null, errorMessage: null }),
}));
