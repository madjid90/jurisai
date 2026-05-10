import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/calendar/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token?.replace(/\.ics$/i, "");
        if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
          return new Response("Invalid token", { status: 400 });
        }

        const { data: integ } = await supabaseAdmin
          .from("tenant_integrations")
          .select("tenant_id")
          .eq("calendar_token", token)
          .maybeSingle();

        if (!integ?.tenant_id) {
          return new Response("Not found", { status: 404 });
        }
        const tenantId = integ.tenant_id as string;

        const [{ data: deadlines }, { data: tasks }] = await Promise.all([
          supabaseAdmin
            .from("dossier_deadlines")
            .select("id, title, description, due_date, completed, dossier_id")
            .eq("tenant_id", tenantId).eq("completed", false)
            .order("due_date", { ascending: true }).limit(500),
          supabaseAdmin
            .from("dossier_tasks")
            .select("id, title, description, due_date, status, dossier_id")
            .eq("tenant_id", tenantId).neq("status", "done")
            .not("due_date", "is", null)
            .order("due_date", { ascending: true }).limit(500),
        ]);

        const events: string[] = [];
        const now = formatICSDate(new Date());

        for (const d of (deadlines ?? []) as any[]) {
          if (!d.due_date) continue;
          events.push(buildEvent({
            uid: `deadline-${d.id}@jurisai`,
            dtstamp: now,
            start: d.due_date,
            summary: `⏰ ${d.title}`,
            description: d.description ?? "",
            url: `/dossiers/${d.dossier_id}`,
          }));
        }
        for (const t of (tasks ?? []) as any[]) {
          if (!t.due_date) continue;
          events.push(buildEvent({
            uid: `task-${t.id}@jurisai`,
            dtstamp: now,
            start: t.due_date,
            summary: `📝 ${t.title}`,
            description: t.description ?? "",
            url: `/dossiers/${t.dossier_id}`,
          }));
        }

        const ics = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//JurisAI//Calendar//FR",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
          "X-WR-CALNAME:JurisAI — Échéances & Tâches",
          "X-WR-TIMEZONE:Europe/Paris",
          ...events,
          "END:VCALENDAR",
        ].join("\r\n");

        return new Response(ics, {
          status: 200,
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="jurisai.ics"',
            "Cache-Control": "private, max-age=300",
          },
        });
      },
    },
  },
});

function formatICSDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICS(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildEvent(opts: {
  uid: string; dtstamp: string; start: string;
  summary: string; description: string; url: string;
}): string {
  const start = formatICSDate(opts.start);
  // 30-min default duration
  const end = formatICSDate(new Date(new Date(opts.start).getTime() + 30 * 60 * 1000));
  return [
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${opts.dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICS(opts.summary)}`,
    opts.description ? `DESCRIPTION:${escapeICS(opts.description)}` : "",
    `URL:${opts.url}`,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}
