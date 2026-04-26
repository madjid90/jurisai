// Edge function pour créer un compte de démo prêt à l'emploi
// Usage : POST https://yuvysjsyumxpekzvlzsx.supabase.co/functions/v1/seed-demo
// Body : { "email": "demo@jurisai.test", "password": "Demo1234!" } (optionnel)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const email = body.email ?? `demo+${Date.now()}@jurisai.test`;
    const password = body.password ?? "Demo1234!";

    // 1. Créer le user (ou récupérer s'il existe déjà)
    let userId: string;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Démo JurisAI" },
    });

    if (createErr && !createErr.message.includes("already")) {
      throw new Error(`Création user: ${createErr.message}`);
    }

    if (created?.user) {
      userId = created.user.id;
    } else {
      // Récupère l'existant
      const { data: list } = await admin.auth.admin.listUsers();
      const existing = list.users.find((u) => u.email === email);
      if (!existing) throw new Error("User introuvable après création");
      userId = existing.id;
    }

    // 2. Créer le tenant
    const slug = `demo-${userId.slice(0, 8)}`;
    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .upsert(
        {
          name: "Cabinet Démo JurisAI",
          slug,
          plan: "pro",
          quota_questions: 500,
          sector: "Conseil RH",
          idcc: "1486",
        },
        { onConflict: "slug" },
      )
      .select()
      .single();
    if (tenantErr) throw new Error(`Tenant: ${tenantErr.message}`);
    const tenantId = tenant.id;

    // 3. Mettre à jour le profil
    await admin
      .from("profiles")
      .update({
        tenant_id: tenantId,
        full_name: "Démo JurisAI",
        job_title: "DRH",
        onboarded: true,
      })
      .eq("id", userId);

    // 4. Rôle admin
    await admin
      .from("user_roles")
      .upsert(
        { user_id: userId, tenant_id: tenantId, role: "admin" },
        { onConflict: "user_id,tenant_id,role" },
      );

    // 5. Clients de démo
    const clients = [
      {
        full_name: "Sophie Dupont",
        email: "sophie.dupont@example.com",
        phone: "06 12 34 56 78",
        job_title: "Comptable",
        contract_type: "CDI",
        hire_date: "2019-03-15",
        notes: "Salariée à temps plein, bons retours managériaux.",
      },
      {
        full_name: "Marc Lefèvre",
        email: "marc.lefevre@example.com",
        phone: "06 98 76 54 32",
        job_title: "Commercial",
        contract_type: "CDI",
        hire_date: "2021-09-01",
        notes: "Période d'essai validée, en discussion sur rupture conventionnelle.",
      },
      {
        full_name: "Aïcha Benali",
        email: "aicha.benali@example.com",
        phone: "07 11 22 33 44",
        job_title: "Développeuse",
        contract_type: "CDD",
        hire_date: "2024-01-10",
        notes: "CDD 12 mois pour remplacement congé maternité.",
      },
    ];
    const { data: insertedClients } = await admin
      .from("clients")
      .insert(
        clients.map((c) => ({ ...c, tenant_id: tenantId, created_by: userId })),
      )
      .select();

    // 6. Dossiers de démo
    const dossiers = [
      {
        title: "Rupture conventionnelle — Lefèvre",
        description: "Négociation de rupture conventionnelle, calcul indemnité spécifique.",
        category: "rupture",
        status: "open",
        risk_level: "medium",
        client_id: insertedClients?.[1]?.id ?? null,
      },
      {
        title: "Renouvellement CDD — Benali",
        description: "Étudier les options de renouvellement ou passage en CDI.",
        category: "contrat",
        status: "open",
        risk_level: "low",
        client_id: insertedClients?.[2]?.id ?? null,
      },
      {
        title: "Avertissement disciplinaire",
        description: "Procédure d'avertissement pour retards répétés.",
        category: "discipline",
        status: "open",
        risk_level: "high",
        client_id: insertedClients?.[0]?.id ?? null,
      },
    ];
    const { data: insertedDossiers } = await admin
      .from("dossiers")
      .insert(
        dossiers.map((d) => ({ ...d, tenant_id: tenantId, created_by: userId })),
      )
      .select();

    // 7. Échéances de démo
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const deadlines = [
      {
        dossier_id: insertedDossiers?.[0]?.id,
        title: "Entretien préalable rupture",
        description: "Convocation envoyée, entretien à programmer.",
        due_date: new Date(now + 5 * day).toISOString(),
      },
      {
        dossier_id: insertedDossiers?.[1]?.id,
        title: "Fin de CDD",
        description: "Décider du renouvellement avant cette date.",
        due_date: new Date(now + 30 * day).toISOString(),
      },
      {
        dossier_id: insertedDossiers?.[2]?.id,
        title: "Convocation entretien préalable",
        description: "Délai légal de 5 jours ouvrables à respecter.",
        due_date: new Date(now - 2 * day).toISOString(), // en retard
      },
    ];
    if (insertedDossiers?.length) {
      await admin.from("dossier_deadlines").insert(
        deadlines
          .filter((d) => d.dossier_id)
          .map((d) => ({
            ...d,
            tenant_id: tenantId,
            created_by: userId,
          })),
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        credentials: { email, password },
        tenant: { id: tenantId, name: tenant.name, slug },
        seeded: {
          clients: insertedClients?.length ?? 0,
          dossiers: insertedDossiers?.length ?? 0,
          deadlines: deadlines.length,
        },
        message: `Connecte-toi avec ${email} / ${password}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
