import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { jsPDF } from "jspdf";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Generate a PDF synthesis of a dossier (case file).
 * Returns base64-encoded PDF + filename so the client can trigger a download.
 *
 * Layout: cover (title, status, client) → description → deadlines table → footer.
 */
export const exportDossierPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ dossierId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };

    // Fetch dossier (RLS check via tenant_id)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) throw new Error("No tenant");

    const { data: dossier, error } = await supabaseAdmin
      .from("dossiers")
      .select("*")
      .eq("id", data.dossierId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!dossier) throw new Error("Dossier introuvable");

    const d = dossier as {
      id: string;
      title: string;
      description: string | null;
      status: string;
      category: string;
      risk_level: string;
      created_at: string;
      closed_at: string | null;
      client_id: string | null;
    };

    // Optional client
    let clientName = "—";
    if (d.client_id) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("full_name, job_title")
        .eq("id", d.client_id)
        .maybeSingle();
      const cc = c as { full_name: string; job_title: string | null } | null;
      if (cc) clientName = cc.job_title ? `${cc.full_name} (${cc.job_title})` : cc.full_name;
    }

    // Deadlines
    const { data: deadlines } = await supabaseAdmin
      .from("dossier_deadlines")
      .select("title, description, due_date, completed")
      .eq("dossier_id", d.id)
      .order("due_date", { ascending: true });

    // Tenant info for header
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();
    const tenantName = (tenant as { name: string } | null)?.name ?? "JurisAI";

    // ─── Build PDF ────────────────────────────────────────────────────────
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;
    let y = M;

    // Header band
    doc.setFillColor(20, 30, 50);
    doc.rect(0, 0, W, 80, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("JurisAI", M, 38);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Synthèse de dossier — ${tenantName}`, M, 58);
    doc.text(new Date().toLocaleDateString("fr-FR"), W - M, 58, { align: "right" });

    y = 110;

    // Title
    doc.setTextColor(20, 30, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(d.title, W - 2 * M);
    doc.text(titleLines, M, y);
    y += titleLines.length * 20 + 8;

    // Meta line
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 110, 130);
    doc.text(
      `Statut : ${d.status}  •  Catégorie : ${d.category}  •  Risque : ${d.risk_level}`,
      M,
      y,
    );
    y += 16;
    doc.text(`Client : ${clientName}`, M, y);
    y += 14;
    doc.text(
      `Créé le ${new Date(d.created_at).toLocaleDateString("fr-FR")}${
        d.closed_at ? ` • Clos le ${new Date(d.closed_at).toLocaleDateString("fr-FR")}` : ""
      }`,
      M,
      y,
    );
    y += 24;

    // Separator
    doc.setDrawColor(220, 225, 235);
    doc.line(M, y, W - M, y);
    y += 20;

    // Description
    doc.setTextColor(20, 30, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Description", M, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(50, 60, 80);
    const descLines = doc.splitTextToSize(d.description ?? "Aucune description.", W - 2 * M);
    doc.text(descLines, M, y);
    y += descLines.length * 14 + 24;

    // Deadlines
    doc.setTextColor(20, 30, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Échéances (${(deadlines ?? []).length})`, M, y);
    y += 18;

    const dls = (deadlines ?? []) as Array<{
      title: string;
      description: string | null;
      due_date: string;
      completed: boolean;
    }>;

    if (dls.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(120, 130, 150);
      doc.text("Aucune échéance enregistrée.", M, y);
      y += 14;
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(120, 130, 150);
      doc.text("ÉCHÉANCE", M, y);
      doc.text("INTITULÉ", M + 90, y);
      doc.text("ÉTAT", W - M - 50, y);
      y += 4;
      doc.setDrawColor(220, 225, 235);
      doc.line(M, y, W - M, y);
      y += 12;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(40, 50, 70);

      for (const dl of dls) {
        if (y > H - 80) {
          doc.addPage();
          y = M;
        }
        const due = new Date(dl.due_date).toLocaleDateString("fr-FR");
        const titleW = doc.splitTextToSize(dl.title, W - M - 90 - 60);
        doc.text(due, M, y);
        doc.text(titleW, M + 90, y);
        doc.setTextColor(dl.completed ? 30 : 200, dl.completed ? 130 : 80, dl.completed ? 60 : 40);
        doc.text(dl.completed ? "✓ Fait" : "À faire", W - M - 50, y);
        doc.setTextColor(40, 50, 70);
        y += titleW.length * 13 + 6;
      }
    }

    // Footer on last page
    doc.setFontSize(8);
    doc.setTextColor(150, 160, 180);
    doc.text(
      `Document généré par JurisAI le ${new Date().toLocaleString("fr-FR")} — Information juridique non contractuelle.`,
      M,
      H - 20,
    );

    // jsPDF .output('arraybuffer') is reliable in Worker runtime
    const ab = doc.output("arraybuffer") as ArrayBuffer;
    const bytes = new Uint8Array(ab);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    // Log usage
    await supabaseAdmin.from("usage_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "export_dossier_pdf",
      metadata: { dossier_id: d.id, deadlines_count: dls.length },
    } as never);

    const safeName = d.title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "dossier";
    return {
      filename: `dossier_${safeName}_${d.id.slice(0, 8)}.pdf`,
      base64,
      mime: "application/pdf",
    };
  });
