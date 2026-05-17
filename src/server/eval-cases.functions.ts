// Server functions pour la validation des cas d'évaluation RAG.
// Super_admin only. Permet de valider/rejeter rapidement les 50 cas existants
// avant qu'ils comptent dans les métriques d'eval LRE.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertSuperAdmin(userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: super_admin required");
}

export const listEvalCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await assertSuperAdmin(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data, error } = await sb
      .from("rag_eval_cases")
      .select("id, question, expected_sources, expected_answer_keywords, category, difficulty, idcc, active, validated, validated_at, rejection_reason")
      .order("validated", { ascending: true })
      .order("category", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const validateEvalCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertSuperAdmin(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("rag_eval_cases")
      .update({
        validated: true,
        validated_by: userId,
        validated_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq("id", data.caseId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectEvalCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), reason: z.string().max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertSuperAdmin(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("rag_eval_cases")
      .update({
        validated: false,
        validated_by: userId,
        validated_at: new Date().toISOString(),
        rejection_reason: data.reason,
        active: false,
      })
      .eq("id", data.caseId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
