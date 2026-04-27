import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://yuvysjsyumxpekzvlzsx.supabase.co";

export const runOcrDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      storage_path: z.string().min(1),
      filename: z.string().min(1).max(200),
      file_type: z.string().min(1).max(100),
      dossier_id: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { accessToken?: string };
    const accessToken = ctx.accessToken ?? "";
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ocr-document`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OCR ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as { id: string; text: string; length: number };
  });
