import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://yuvysjsyumxpekzvlzsx.supabase.co";

export const runLegalAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        message: z.string().trim().min(1).max(4000),
        dossier_id: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { accessToken?: string };
    const accessToken = ctx.accessToken ?? "";

    const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: data.message,
        dossier_id: data.dossier_id ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Agent error ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as {
      answer: string;
      intent: { intent: string; domain: string; confidence: number } | null;
      sources: Array<{ n: number; title: string; ref: string | null; url: string | null }>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trace: Array<{ tool: string; args: any; result: any }>;
    };
  });
