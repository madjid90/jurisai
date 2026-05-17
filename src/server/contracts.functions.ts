// Server functions exposées pour la comparaison de contrats.
// L'agent peut aussi appeler ce module via l'outil `compare_contracts`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTenantId } from "@/server/_shared/tenant.server";
import { compareContracts } from "@/server/_shared/contract-compare.server";

const CompareInput = z.object({
  docAId: z.string().uuid(),
  docBId: z.string().uuid(),
});

export const compareContractsServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CompareInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    if (!tenantId) throw new Error("Tenant introuvable");

    // Audit fix : rate limit pour éviter explosion coût LLM (compare = ~0.05€/run)
    const { enforceRateLimit } = await import("@/server/_shared/rate-limit.server");
    await enforceRateLimit(userId, "compare-contracts", 10);
    return compareContracts({
      docAId: data.docAId,
      docBId: data.docBId,
      ctx: { tenantId },
    });
  });
