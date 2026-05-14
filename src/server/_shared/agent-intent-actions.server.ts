// Routage par intent dans le pipeline executeAgentRun.
// Pour chaque intent métier, on déclenche l'action concrète :
//  - analyse_document  → entités déjà extraites + extraction d'échéances → contract_deadlines
//  - redaction_document / lancer_procedure → templates correspondants → génération + final_document_ids
//  - gestion_dossier / recherche_dossier → renvoyer la timeline du dossier dans le draft
// Tout est non-bloquant : si une action secondaire échoue, l'agent renvoie quand même sa réponse.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logTimelineEvent } from "./timeline.server";
import { extractEntities } from "./entity-extraction.server";
import { prefillSession } from "./prefill.server";
import type { PrefillSource, TemplateField } from "@/lib/templates/template-config";
import { fillTemplate } from "./template";
import { calculateIndemnity, saveCalculation, type CalculationInput } from "./indemnity-calculator.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type Run = {
  status: string;
  message: string;
  draft: Record<string, unknown>;
  topic: string | null;
  dossier_id: string | null;
};

type Extras = {
  documentIds: string[];
  timeline?: unknown[];
  deadlines?: unknown[];
  suggestedTemplates?: unknown[];
  risks?: Array<{ id: string; title: string; severity: string }>;
  workflowInstanceId?: string | null;
  calculationResult?: unknown;
  upcomingDeadlines?: unknown[];
  prescriptionInfo?: unknown[];
  conformiteChecklist?: unknown;
};

const DOC_INTENTS = new Set(["redaction_document"]);
const PROCEDURE_INTENTS = new Set(["lancer_procedure"]);
const ANALYSIS_INTENTS = new Set(["analyse_document", "analyse_contrat"]);
const SEARCH_INTENTS = new Set(["recherche_dossier", "gestion_dossier"]);
const CHIFFRAGE_INTENTS = new Set(["chiffrage"]);
const RECLAMATION_INTENTS = new Set(["reclamation"]);
const ECHEANCE_INTENTS = new Set(["suivi_echeance"]);
const CONFORMITE_INTENTS = new Set(["conformite"]);

export async function runIntentActions(opts: {
  intent: string;
  run: Run;
  draft: Record<string, unknown>;
  userId: string;
  tenantId: string;
  runId: string;
}): Promise<Extras> {
  const { intent, run, draft, userId, tenantId, runId } = opts;
  const out: Extras = { documentIds: [] };

  try {
    if (ANALYSIS_INTENTS.has(intent)) {
      // Analyse de document/contrat : extraire échéances + récupérer risques détectés
      const attachmentIds = collectAttachmentIds(draft);
      out.deadlines = await extractAndPersistDeadlines({
        tenantId,
        userId,
        runId,
        dossierId: run.dossier_id,
        analysisIds: attachmentIds,
      });
      // Risques déjà identifiés sur le dossier (alimentés par analysis.functions.ts)
      if (run.dossier_id) {
        const { data: risks } = await db
          .from("identified_risks")
          .select("id, title, severity")
          .eq("tenant_id", tenantId)
          .eq("dossier_id", run.dossier_id)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(10);
        out.risks = (risks ?? []) as Array<{ id: string; title: string; severity: string }>;
      }
    }

    if (DOC_INTENTS.has(intent)) {
      // Génération document : suggérer + générer un brouillon HTML pré-rempli
      const suggested = await suggestTemplates({
        tenantId,
        topic: run.topic ?? run.message,
      });
      out.suggestedTemplates = suggested;
      if (suggested.length > 0) {
        const docId = await generateDraftDocument({
          tenantId,
          userId,
          runId,
          dossierId: run.dossier_id,
          templateId: suggested[0].id as string,
          collected: (draft.form as Record<string, unknown>) ?? {},
          uploadedAnalysisId: collectAttachmentIds(draft)[0] ?? null,
        });
        if (docId) out.documentIds.push(docId);
      }
    }

    if (PROCEDURE_INTENTS.has(intent)) {
      // Procédure : chercher un workflow existant → sinon en générer un → démarrer l'instance.
      const workflowResult = await findOrGenerateWorkflow({
        tenantId,
        userId,
        runId,
        dossierId: run.dossier_id,
        topic: run.topic ?? run.message,
        message: run.message,
        collected: (draft.form as Record<string, unknown>) ?? {},
      });
      if (workflowResult) {
        draft.workflow = workflowResult;
        out.workflowInstanceId = workflowResult.instance_id;
        // Si un document a été généré pour la première étape
        if (workflowResult.first_document_id) {
          out.documentIds.push(workflowResult.first_document_id);
        }
      }

      // Aussi générer les documents pertinents (lettres, convocations)
      const suggested = await suggestTemplates({
        tenantId,
        topic: run.topic ?? run.message,
      });
      out.suggestedTemplates = suggested;
      if (suggested.length > 0) {
        const docId = await generateDraftDocument({
          tenantId,
          userId,
          runId,
          dossierId: run.dossier_id,
          templateId: suggested[0].id as string,
          collected: (draft.form as Record<string, unknown>) ?? {},
          uploadedAnalysisId: collectAttachmentIds(draft)[0] ?? null,
        });
        if (docId) out.documentIds.push(docId);
      }
    }

    if (CHIFFRAGE_INTENTS.has(intent)) {
      // Chiffrage : calculer les indemnités à partir des infos collectées dans le formulaire
      const form = (draft.form as Record<string, string | number | undefined>) ?? {};
      const salaire = parseFloat(String(form.salaire_mensuel_brut ?? form.salaire ?? form.salaire_brut ?? 0));
      const anciennete = parseInt(String(form.anciennete_mois ?? form.anciennete ?? 0), 10);
      const motif = String(form.motif ?? form.type_rupture ?? "licenciement_cause_reelle");

      if (salaire > 0 && anciennete > 0) {
        try {
          const calcInput: CalculationInput = {
            salaireMensuelBrut: salaire,
            salaireMoyen12m: form.salaire_moyen_12m ? parseFloat(String(form.salaire_moyen_12m)) : undefined,
            salaireMoyen3m: form.salaire_moyen_3m ? parseFloat(String(form.salaire_moyen_3m)) : undefined,
            ancienneteMois: anciennete,
            motif: motif as CalculationInput["motif"],
            idcc: form.idcc ? String(form.idcc) : undefined,
            categorie: form.categorie ? String(form.categorie) : undefined,
            tailleEntreprise: (form.taille_entreprise as "standard" | "small") ?? "standard",
            joursCongesNonPris: form.jours_conges ? parseInt(String(form.jours_conges), 10) : undefined,
          };

          const result = await calculateIndemnity(calcInput);
          const calcId = await saveCalculation(tenantId, userId, run.dossier_id, calcInput, result);

          out.calculationResult = { calculation_id: calcId, ...result };

          // Injecter le résultat dans le draft pour que le LLM l'utilise dans sa réponse
          draft.calculation = { calculation_id: calcId, ...result };

          if (run.dossier_id) {
            await logTimelineEvent({
              tenantId,
              dossierId: run.dossier_id,
              actorId: userId,
              eventType: "calculation.completed",
              title: `Chiffrage ${motif} : ${result.totalBrut.toFixed(2)}€`,
              metadata: { calculation_id: calcId, motif, total_brut: result.totalBrut },
            });
          }
        } catch (calcErr) {
          console.error("[agent-intent-actions] chiffrage failed", calcErr);
        }
      }
    }

    if (RECLAMATION_INTENTS.has(intent)) {
      // Réclamation : suggérer des templates de courrier (mise en demeure, réclamation,
      // contestation) ET chercher les délais de prescription applicables.
      const suggested = await suggestTemplates({
        tenantId,
        topic: `${run.topic ?? run.message} réclamation contestation mise en demeure`,
      });
      out.suggestedTemplates = suggested;

      // Générer un brouillon si un template matche
      if (suggested.length > 0) {
        const docId = await generateDraftDocument({
          tenantId,
          userId,
          runId,
          dossierId: run.dossier_id,
          templateId: suggested[0].id as string,
          collected: (draft.form as Record<string, unknown>) ?? {},
          uploadedAnalysisId: collectAttachmentIds(draft)[0] ?? null,
        });
        if (docId) out.documentIds.push(docId);
      }

      // Chercher les délais de prescription pertinents
      const topicLower = (run.topic ?? run.message).toLowerCase();
      const { data: prescriptions } = await db
        .from("prescription_periods")
        .select("type, label, duration_value, duration_unit, starting_point, source_ref, notes")
        .is("valid_to", null)
        .order("type");

      if (prescriptions && prescriptions.length > 0) {
        // Filtrer par pertinence avec le sujet
        const tokens = topicLower.split(/\s+/).filter((w: string) => w.length >= 4);
        const relevant = (prescriptions as Array<{ type: string; label: string; [k: string]: unknown }>)
          .filter((p) => {
            const hay = `${p.type} ${p.label}`.toLowerCase();
            return tokens.some((t: string) => hay.includes(t));
          })
          .slice(0, 5);

        // Si pas de match spécifique, renvoyer les 5 plus courants
        out.prescriptionInfo = relevant.length > 0 ? relevant : (prescriptions as unknown[]).slice(0, 5);
        draft.prescription_info = out.prescriptionInfo;
      }

      // Créer une tâche de suivi si dossier lié
      if (run.dossier_id) {
        await db.from("dossier_tasks").insert({
          tenant_id: tenantId,
          dossier_id: run.dossier_id,
          title: `Réclamation : ${(run.topic ?? "à qualifier").slice(0, 100)}`,
          priority: "high",
          status: "todo",
          created_by: userId,
        });

        await logTimelineEvent({
          tenantId,
          dossierId: run.dossier_id,
          actorId: userId,
          eventType: "reclamation.initiated",
          title: `Réclamation initiée : ${(run.topic ?? "—").slice(0, 100)}`,
          metadata: { run_id: runId, templates_suggested: suggested.length },
        });
      }
    }

    if (ECHEANCE_INTENTS.has(intent)) {
      // Suivi échéances : charger toutes les échéances proches (30 jours) du tenant
      // + les échéances du dossier actif si applicable
      const today = new Date().toISOString().split("T")[0];
      const in30days = new Date(Date.now() + 30 * 86_400_000).toISOString().split("T")[0];

      // Échéances dossier_deadlines
      let deadlineQuery = db
        .from("dossier_deadlines")
        .select("id, title, due_date, status, dossier_id")
        .eq("tenant_id", tenantId)
        .gte("due_date", today)
        .lte("due_date", in30days)
        .order("due_date", { ascending: true })
        .limit(20);

      if (run.dossier_id) {
        deadlineQuery = deadlineQuery.eq("dossier_id", run.dossier_id);
      }

      const { data: deadlines } = await deadlineQuery;

      // Échéances contrats (contract_deadlines)
      let contractQuery = db
        .from("contract_deadlines")
        .select("id, label, due_date, category, dossier_id")
        .eq("tenant_id", tenantId)
        .gte("due_date", today)
        .lte("due_date", in30days)
        .order("due_date", { ascending: true })
        .limit(20);

      if (run.dossier_id) {
        contractQuery = contractQuery.eq("dossier_id", run.dossier_id);
      }

      const { data: contractDeadlines } = await contractQuery;

      // Tâches en retard
      const { data: overdueTasks } = await db
        .from("dossier_tasks")
        .select("id, title, due_date, priority, status, dossier_id")
        .eq("tenant_id", tenantId)
        .in("status", ["todo", "in_progress"])
        .not("due_date", "is", null)
        .lt("due_date", today)
        .order("due_date", { ascending: true })
        .limit(10);

      // Rappels à venir
      const { data: reminders } = await db
        .from("reminders")
        .select("id, title, remind_at, channel, dossier_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .eq("is_read", false)
        .gte("remind_at", today)
        .lte("remind_at", in30days)
        .order("remind_at", { ascending: true })
        .limit(10);

      out.upcomingDeadlines = [
        ...(deadlines ?? []).map((d: any) => ({ ...d, source: "dossier_deadline" })),
        ...(contractDeadlines ?? []).map((d: any) => ({ ...d, source: "contract_deadline" })),
        ...(overdueTasks ?? []).map((d: any) => ({ ...d, source: "overdue_task" })),
        ...(reminders ?? []).map((d: any) => ({ ...d, source: "reminder" })),
      ];

      // Injecter dans le draft pour le LLM
      draft.upcoming_deadlines = out.upcomingDeadlines;
      draft.deadlines_summary = {
        total: (out.upcomingDeadlines as unknown[]).length,
        overdue_tasks: (overdueTasks ?? []).length,
        deadlines_30j: (deadlines ?? []).length + (contractDeadlines ?? []).length,
        reminders: (reminders ?? []).length,
      };
    }

    if (CONFORMITE_INTENTS.has(intent)) {
      // Conformité : générer une checklist d'obligations selon le domaine détecté
      const topicLower = (run.topic ?? run.message).toLowerCase();
      const form = (draft.form as Record<string, string | undefined>) ?? {};

      // Détecter le domaine de conformité
      const isRGPD = /rgpd|donn[eé]es|cnil|dpo|privacy|cookie|gdpr/.test(topicLower);
      const isSocial = /duerp|cse|registre|affichage|visite|m[eé]decine|s[eé]curit[eé]|at.mp|accident/.test(topicLower);
      const isCommercial = /cgu|cgv|mentions|l[eé]gales|facturation|devis/.test(topicLower);

      const checklist: Array<{
        category: string;
        item: string;
        obligatoire: boolean;
        reference: string;
        status: "unknown";
      }> = [];

      if (isRGPD || (!isSocial && !isCommercial)) {
        checklist.push(
          { category: "RGPD", item: "Registre des traitements", obligatoire: true, reference: "Art. 30 RGPD", status: "unknown" },
          { category: "RGPD", item: "Désignation DPO (si nécessaire)", obligatoire: false, reference: "Art. 37 RGPD", status: "unknown" },
          { category: "RGPD", item: "Analyse d'impact (AIPD) pour traitements à risque", obligatoire: true, reference: "Art. 35 RGPD", status: "unknown" },
          { category: "RGPD", item: "Mentions d'information sur les formulaires", obligatoire: true, reference: "Art. 13 RGPD", status: "unknown" },
          { category: "RGPD", item: "Politique de confidentialité à jour", obligatoire: true, reference: "Art. 12 RGPD", status: "unknown" },
          { category: "RGPD", item: "Contrats sous-traitants (DPA)", obligatoire: true, reference: "Art. 28 RGPD", status: "unknown" },
          { category: "RGPD", item: "Procédure de gestion des droits (accès, rectification, suppression)", obligatoire: true, reference: "Art. 15-21 RGPD", status: "unknown" },
          { category: "RGPD", item: "Registre des violations de données", obligatoire: true, reference: "Art. 33 RGPD", status: "unknown" },
          { category: "RGPD", item: "Consentement cookies (bandeau)", obligatoire: true, reference: "Art. 82 Loi Informatique et Libertés", status: "unknown" },
        );
      }

      if (isSocial || (!isRGPD && !isCommercial)) {
        checklist.push(
          { category: "Social", item: "Document Unique d'Évaluation des Risques (DUERP)", obligatoire: true, reference: "Art. R4121-1 CT", status: "unknown" },
          { category: "Social", item: "Affichages obligatoires", obligatoire: true, reference: "Art. R2262-1 CT", status: "unknown" },
          { category: "Social", item: "Registre unique du personnel", obligatoire: true, reference: "Art. L1221-13 CT", status: "unknown" },
          { category: "Social", item: "Règlement intérieur (≥50 salariés)", obligatoire: false, reference: "Art. L1311-2 CT", status: "unknown" },
          { category: "Social", item: "Mise en place CSE (≥11 salariés)", obligatoire: false, reference: "Art. L2311-2 CT", status: "unknown" },
          { category: "Social", item: "Entretien professionnel tous les 2 ans", obligatoire: true, reference: "Art. L6315-1 CT", status: "unknown" },
          { category: "Social", item: "Visite médicale d'embauche / suivi", obligatoire: true, reference: "Art. R4624-10 CT", status: "unknown" },
          { category: "Social", item: "Déclaration Préalable à l'Embauche (DPAE)", obligatoire: true, reference: "Art. L1221-10 CT", status: "unknown" },
          { category: "Social", item: "Index égalité femmes-hommes (≥50 salariés)", obligatoire: false, reference: "Art. L1142-8 CT", status: "unknown" },
        );
      }

      if (isCommercial || (!isRGPD && !isSocial)) {
        checklist.push(
          { category: "Commercial", item: "Mentions légales site internet", obligatoire: true, reference: "Art. 6 LCEN", status: "unknown" },
          { category: "Commercial", item: "CGV / CGU à jour", obligatoire: true, reference: "Art. L441-1 Code de commerce", status: "unknown" },
          { category: "Commercial", item: "Mentions obligatoires sur les factures", obligatoire: true, reference: "Art. L441-9 Code de commerce", status: "unknown" },
          { category: "Commercial", item: "Délais de paiement légaux", obligatoire: true, reference: "Art. L441-10 Code de commerce", status: "unknown" },
          { category: "Commercial", item: "Assurance RC Professionnelle", obligatoire: false, reference: "Selon activité", status: "unknown" },
        );
      }

      out.conformiteChecklist = {
        domain: isRGPD ? "RGPD" : isSocial ? "Social" : isCommercial ? "Commercial" : "Général",
        items: checklist,
        total_items: checklist.length,
        note: "Statuts à vérifier par l'utilisateur. Cette checklist est indicative et non exhaustive.",
      };

      // Injecter dans le draft
      draft.conformite_checklist = out.conformiteChecklist;

      // Suggérer des templates de registres/documents de conformité
      const suggested = await suggestTemplates({
        tenantId,
        topic: `${run.topic ?? run.message} conformité registre`,
      });
      if (suggested.length > 0) {
        out.suggestedTemplates = suggested;
      }

      if (run.dossier_id) {
        await logTimelineEvent({
          tenantId,
          dossierId: run.dossier_id,
          actorId: userId,
          eventType: "conformite.audit_requested",
          title: `Audit conformité demandé : ${isRGPD ? "RGPD" : isSocial ? "Social" : isCommercial ? "Commercial" : "Général"}`,
          metadata: { run_id: runId, checklist_items: checklist.length },
        });
      }
    }

    if (SEARCH_INTENTS.has(intent) && run.dossier_id) {
      // Recherche/gestion dossier : renvoyer la timeline récente
      const { data: events } = await db
        .from("case_timeline_events")
        .select("id, event_type, title, description, occurred_at, metadata")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", run.dossier_id)
        .order("occurred_at", { ascending: false })
        .limit(20);
      out.timeline = events ?? [];
    }
  } catch (err) {
    console.error("[agent-intent-actions] failed", intent, err);
  }

  return out;
}

function collectAttachmentIds(draft: Record<string, unknown>): string[] {
  const att = (draft.attachments as Array<{ analysis_id?: string }> | undefined) ?? [];
  return att
    .map((a) => a?.analysis_id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
}

// ---------------------------------------------------------------------------
// Échéances de contrat
// ---------------------------------------------------------------------------

async function extractAndPersistDeadlines(opts: {
  tenantId: string;
  userId: string;
  runId: string;
  dossierId: string | null;
  analysisIds: string[];
}) {
  if (opts.analysisIds.length === 0) return [];

  const { data: analyses } = await db
    .from("document_analyses")
    .select("id, filename, extracted_text, analysis")
    .in("id", opts.analysisIds)
    .eq("tenant_id", opts.tenantId);

  const persisted: Array<{ label: string; due_date: string; category: string | null }> = [];

  for (const doc of (analyses ?? []) as Array<{
    id: string;
    filename: string;
    extracted_text: string | null;
    analysis: Record<string, unknown> | null;
  }>) {
    const text = doc.extracted_text ?? "";
    if (!text) continue;
    const entities = extractEntities(text);
    const dates = entities
      .filter((e) => e.type === "date")
      .map((e) => parseFrenchDate(e.raw))
      .filter((d): d is Date => d != null && d.getTime() > Date.now() - 86_400_000);

    // Inférer le label depuis le contexte (~80 chars autour de la date)
    for (const date of dates.slice(0, 8)) {
      const iso = date.toISOString().slice(0, 10);
      const label = inferLabel(text, iso) ?? `Échéance — ${doc.filename}`;
      const category = inferCategory(label);

      const { data: row } = await db
        .from("contract_deadlines")
        .insert({
          tenant_id: opts.tenantId,
          document_analysis_id: doc.id,
          agent_run_id: opts.runId,
          dossier_id: opts.dossierId,
          label,
          due_date: iso,
          category,
        })
        .select("id, label, due_date, category")
        .single();

      if (row) persisted.push({ label: row.label, due_date: row.due_date, category: row.category });
    }
  }

  if (persisted.length > 0 && opts.dossierId) {
    await logTimelineEvent({
      tenantId: opts.tenantId,
      dossierId: opts.dossierId,
      actorId: opts.userId,
      eventType: "contract.deadlines_extracted",
      title: `${persisted.length} échéance(s) extraite(s)`,
      metadata: { count: persisted.length, run_id: opts.runId },
    });
  }

  return persisted;
}

function parseFrenchDate(raw: string): Date | null {
  // R65 (BUG-A14) — format FR strict DD/MM/YYYY, validation jour/mois réelle
  // (rejette 31/02, 30/02, 31/04 etc.).
  const m = raw.match(/(\d{1,2})[\s/.-](\d{1,2})[\s/.-](\d{2,4})/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(dt.getTime())) return null;
  // Vérifie que la date n'a pas été "roulée" (ex: 31/02 → 03/03)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function inferLabel(text: string, iso: string): string | null {
  // Cherche le contexte autour d'un mot-clé proche de la date dans le texte
  const keywords = /(échéance|expiration|renouvellement|résiliation|paiement|fin|terme|préavis|reconduction)/i;
  const lines = text.split(/[\n.;]/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (keywords.test(line) && line.length < 200) return line.slice(0, 180);
  }
  return null;
}

function inferCategory(label: string): string {
  const l = label.toLowerCase();
  if (/résili|préavis|reconduction|renouvel/.test(l)) return "renouvellement";
  if (/paiement|facture|règlement/.test(l)) return "paiement";
  if (/fin|terme|expir/.test(l)) return "fin_contrat";
  return "autre";
}

// ---------------------------------------------------------------------------
// Génération de document pré-rempli
// ---------------------------------------------------------------------------

async function suggestTemplates(opts: { tenantId: string; topic: string }) {
  const q = opts.topic.toLowerCase();
  const { data } = await db
    .from("document_templates")
    .select("id, name, slug, category, risk_level, body, prefill_sources")
    .or(`is_public.eq.true,tenant_id.eq.${opts.tenantId}`)
    .eq("status", "validated")
    .limit(50);

  const all = (data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    category: string | null;
  }>;

  // Score lexical simple
  const scored = all
    .map((t) => {
      const hay = `${t.name} ${t.slug} ${t.category ?? ""}`.toLowerCase();
      const tokens = q.split(/\s+/).filter((w) => w.length > 3);
      const hits = tokens.filter((w) => hay.includes(w)).length;
      return { ...t, score: hits };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored;
}

async function generateDraftDocument(opts: {
  tenantId: string;
  userId: string;
  runId: string;
  dossierId: string | null;
  templateId: string;
  collected: Record<string, unknown>;
  uploadedAnalysisId: string | null;
}): Promise<string | null> {
  // Charge le modèle (avec variables/prefill_sources)
  const { data: tpl } = await db
    .from("document_templates")
    .select("id, name, body, archive_to_case, risk_level, variables, prefill_sources")
    .eq("id", opts.templateId)
    .maybeSingle();
  if (!tpl) return null;

  // Prefill avancé : dossier + client + OCR (sans écraser ce que l'user a fourni)
  const fields = (Array.isArray(tpl.variables) ? tpl.variables : []) as TemplateField[];
  const prefillSources = (Array.isArray(tpl.prefill_sources)
    ? tpl.prefill_sources
    : ["dossier", "client", "ocr"]) as PrefillSource[];

  let merged: Record<string, unknown> = { ...opts.collected };
  let uncertain: Array<{ key: string; reason: string }> = [];
  try {
    const pf = await prefillSession(fields, {
      tenantId: opts.tenantId,
      dossierId: opts.dossierId,
      uploadedAnalysisId: opts.uploadedAnalysisId,
      enabledSources: prefillSources,
    });
    // user-provided values win over prefill
    merged = { ...pf.data, ...opts.collected };
    uncertain = pf.uncertain;
  } catch (err) {
    console.warn("[agent-intent-actions] prefill failed", err);
  }

  // G5 — Substitution {{key}} via le helper partagé.
  const body = (tpl.body as string) ?? "";
  const filled = fillTemplate(body, merged, {
    onMissing: (key) => `[à compléter : ${key}]`,
  });

  const title = `${tpl.name} — ${new Date().toLocaleDateString("fr-FR")}`;

  const { data: doc, error } = await db
    .from("generated_documents")
    .insert({
      tenant_id: opts.tenantId,
      template_id: tpl.id,
      dossier_id: tpl.archive_to_case === false ? null : opts.dossierId,
      generated_by: opts.userId,
      title,
      content_html: filled,
      output_format: "html",
      variables_used: merged,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !doc) {
    console.error("[agent-intent-actions] generateDraftDocument failed", error);
    return null;
  }

  if (opts.dossierId) {
    await logTimelineEvent({
      tenantId: opts.tenantId,
      dossierId: opts.dossierId,
      actorId: opts.userId,
      eventType: "agent.document_generated",
      title: `Document préparé par l'agent : ${tpl.name}`,
      metadata: {
        document_id: doc.id,
        run_id: opts.runId,
        template_id: tpl.id,
        uncertain_fields: uncertain,
      },
    });
  }

  return doc.id as string;
}

// ---------------------------------------------------------------------------
// Workflow : chercher un existant ou en générer un à la volée
// ---------------------------------------------------------------------------

type WorkflowResult = {
  definition_id: string;
  definition_title: string;
  instance_id: string | null;
  generated: boolean;
  first_document_id: string | null;
};

async function findOrGenerateWorkflow(opts: {
  tenantId: string;
  userId: string;
  runId: string;
  dossierId: string | null;
  topic: string;
  message: string;
  collected: Record<string, unknown>;
}): Promise<WorkflowResult | null> {
  try {
    // 1. Chercher un workflow validé qui matche le sujet (scoring lexical)
    const { data: defs } = await db
      .from("workflow_definitions")
      .select("id, title, slug, category, steps")
      .or(`tenant_id.is.null,tenant_id.eq.${opts.tenantId}`)
      .in("lifecycle_status", ["ai_validated_auto", "human_validated"])
      .in("status", ["validated", "template"])
      .limit(50);

    const allDefs = (defs ?? []) as Array<{
      id: string;
      title: string;
      slug: string;
      category: string | null;
      steps: unknown[];
    }>;

    const topicLower = opts.topic.toLowerCase();
    const msgLower = opts.message.toLowerCase();
    const searchStr = `${topicLower} ${msgLower}`;
    const tokens = searchStr.split(/\s+/).filter((w) => w.length >= 4);

    let bestDef: (typeof allDefs)[0] | null = null;
    let bestScore = 0;

    for (const d of allDefs) {
      const hay = `${d.title} ${d.slug} ${d.category ?? ""}`.toLowerCase();
      const hits = tokens.filter((w) => hay.includes(w)).length;
      const score = tokens.length > 0 ? hits / tokens.length : 0;
      if (score > bestScore && score >= 0.3) {
        bestScore = score;
        bestDef = d;
      }
    }

    let definitionId: string;
    let definitionTitle: string;
    let generated = false;

    if (bestDef) {
      // Workflow existant trouvé
      definitionId = bestDef.id;
      definitionTitle = bestDef.title;
      console.log(`[workflow] Matched existing: ${bestDef.slug} (score=${bestScore.toFixed(2)})`);
    } else {
      // Aucun workflow existant → générer à la volée
      console.log(`[workflow] No match found, generating for: ${opts.topic}`);
      try {
        const { runGenerateWorkflow } = await import("@/server/workflow-generator-core.server");
        const genResult = await runGenerateWorkflow(
          { prompt: opts.message, category: inferDomainFromTopic(opts.topic) },
          opts.userId,
        );
        if (genResult?.error || !genResult?.workflow_definition_id) {
          console.warn("[workflow] Generation failed:", genResult?.error);
          return null;
        }
        definitionId = genResult.workflow_definition_id;
        definitionTitle = opts.topic;
        generated = true;

        // Si c'est un duplicata, utiliser la définition existante
        if (genResult.duplicate_of?.id) {
          definitionId = genResult.duplicate_of.id;
          definitionTitle = genResult.duplicate_of.title ?? definitionTitle;
          generated = false;
        }
      } catch (genErr) {
        console.error("[workflow] Generation error:", genErr);
        return null;
      }
    }

    // 2. Démarrer une instance du workflow
    let instanceId: string | null = null;
    try {
      const { data: inst, error: instErr } = await db
        .from("workflow_instances")
        .insert({
          tenant_id: opts.tenantId,
          definition_id: definitionId,
          title: `${definitionTitle} — ${new Date().toLocaleDateString("fr-FR")}`,
          dossier_id: opts.dossierId,
          started_by: opts.userId,
          context: opts.collected,
          status: "in_progress",
          current_step_index: 0,
        })
        .select("id")
        .single();

      if (instErr) {
        console.error("[workflow] Instance creation failed:", instErr);
      } else {
        instanceId = (inst as { id: string }).id;

        // Rattacher l'instance à l'agent_run
        await db
          .from("agent_runs")
          .update({ workflow_instance_id: instanceId })
          .eq("id", opts.runId);

        // Log timeline si dossier
        if (opts.dossierId) {
          await logTimelineEvent({
            tenantId: opts.tenantId,
            dossierId: opts.dossierId,
            actorId: opts.userId,
            eventType: "workflow.started",
            title: `Procédure démarrée : ${definitionTitle}`,
            metadata: {
              source: "agent",
              instance_id: instanceId,
              definition_id: definitionId,
              generated,
              run_id: opts.runId,
            },
          });
        }
      }
    } catch (instErr) {
      console.error("[workflow] Instance start error:", instErr);
    }

    return {
      definition_id: definitionId,
      definition_title: definitionTitle,
      instance_id: instanceId,
      generated,
      first_document_id: null,
    };
  } catch (err) {
    console.error("[workflow] findOrGenerateWorkflow failed:", err);
    return null;
  }
}

function inferDomainFromTopic(topic: string): string | undefined {
  const t = topic.toLowerCase();
  if (/licenciement|embauche|contrat de travail|salari[eé]|cse|entretien|cdd|cdi|pr[eé]avis|inaptitude|disciplin/.test(t)) return "social";
  if (/rgpd|donn[eé]es|cnil|dpo|registre|cookie|privacy/.test(t)) return "rgpd";
  if (/commercial|contrat|fournisseur|client|impay[eé]|cr[eé]ance|mise en demeure/.test(t)) return "commercial";
  if (/soci[eé]t[eé]|associ[eé]|capital|statuts|ag[eé]|g[eé]rant|pr[eé]sident|assemblée/.test(t)) return "societes";
  if (/fiscal|imp[oô]t|tva|bic|is|bénéfice|déclaration/.test(t)) return "fiscal";
  if (/contentieux|tribunal|assignation|conclusions|jugement|appel/.test(t)) return "contentieux";
  return undefined;
}
