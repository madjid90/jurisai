import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  Trash2,
  Copy,
  Check,
  Loader2,
  Crown,
  UserCog,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  sendInvitation,
  revokeInvitation,
} from "@/server/invitations.functions";
import { removeMember } from "@/server/settings.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Équipe · JurisAI" }] }),
  component: TeamPage,
});

type AppRole = "admin" | "manager" | "user";

type Member = {
  id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  role: AppRole;
};

type Invitation = {
  id: string;
  email: string;
  role: AppRole;
  expires_at: string;
  token: string;
  created_at: string;
};

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrateur",
  manager: "Manager",
  user: "Utilisateur",
};

const ROLE_ICONS: Record<AppRole, typeof Crown> = {
  admin: Crown,
  manager: UserCog,
  user: UserIcon,
};

function TeamPage() {
  const { profile, user } = useAuth();
  const sendFn = useServerFn(sendInvitation);
  const revokeFn = useServerFn(revokeInvitation);
  const removeFn = useServerFn(removeMember);

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<AppRole | null>(null);

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("user");
  const [sending, setSending] = useState(false);

  const isAdmin = myRole === "admin";
  const canInvite = myRole === "admin" || myRole === "manager";

  const fetchAll = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);

    // Members: profiles in tenant + their roles
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, email, full_name, job_title")
      .eq("tenant_id", profile.tenant_id);

    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("tenant_id", profile.tenant_id);

    const rolesMap = new Map<string, AppRole>();
    ((rolesData as Array<{ user_id: string; role: AppRole }>) ?? []).forEach((r) => {
      // If user has multiple roles, prioritize admin > manager > user
      const existing = rolesMap.get(r.user_id);
      if (!existing) rolesMap.set(r.user_id, r.role);
      else if (r.role === "admin") rolesMap.set(r.user_id, "admin");
      else if (r.role === "manager" && existing === "user") rolesMap.set(r.user_id, "manager");
    });

    setMembers(
      ((profilesData as Member[]) ?? []).map((p) => ({
        ...p,
        role: rolesMap.get(p.id) ?? "user",
      })),
    );
    if (user) setMyRole(rolesMap.get(user.id) ?? null);

    // Invitations (pending only)
    const { data: invitesData } = await supabase
      .from("invitations")
      .select("id, email, role, expires_at, token, created_at")
      .eq("tenant_id", profile.tenant_id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    setInvitations((invitesData as Invitation[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id, user?.id]);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await sendFn({ data: { email: email.trim(), role } });
      toast.success("Invitation envoyée", { description: email });
      setEmail("");
      setRole("user");
      await fetchAll();
    } catch (err) {
      toast.error("Échec de l'invitation", {
        description: err instanceof Error ? err.message : "Erreur inconnue",
      });
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Révoquer cette invitation ?")) return;
    try {
      await revokeFn({ data: { invitationId: id } });
      toast.success("Invitation révoquée");
      await fetchAll();
    } catch (err) {
      toast.error("Échec", {
        description: err instanceof Error ? err.message : "Erreur",
      });
    }
  };

  const handleRemove = async (member: Member) => {
    if (!confirm(`Retirer ${member.full_name ?? member.email} de l'équipe ?`)) return;
    try {
      await removeFn({ data: { memberId: member.id } });
      toast.success("Membre retiré");
      await fetchAll();
    } catch (err) {
      toast.error("Échec", {
        description: err instanceof Error ? err.message : "Erreur",
      });
    }
  };

  return (
    <AppShell>
      <div className="space-y-3 overflow-y-auto pb-6">
        {/* Header */}
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
              <Users className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-[26px] font-bold tracking-tight text-foreground">Équipe</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Gérez les membres et les invitations de votre organisation.
              </p>
            </div>
          </div>
        </div>

        {/* Invite form */}
        {canInvite && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-accent" />
              <h2 className="text-[15px] font-semibold text-foreground">Inviter un membre</h2>
            </div>
            <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@entreprise.fr"
                disabled={sending}
                className="h-11 flex-1 rounded-xl border border-border bg-background px-4 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AppRole)}
                disabled={sending}
                className="h-11 rounded-xl border border-border bg-background px-3 text-[14px] text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="user">Utilisateur</option>
                <option value="manager">Manager</option>
                {isAdmin && <option value="admin">Administrateur</option>}
              </select>
              <button
                type="submit"
                disabled={sending}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Inviter
              </button>
            </form>
          </div>
        )}

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <h2 className="mb-4 text-[15px] font-semibold text-foreground">
              Invitations en attente ({invitations.length})
            </h2>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <InviteRow
                  key={inv.id}
                  invitation={inv}
                  canManage={canInvite}
                  onRevoke={() => void handleRevoke(inv.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Members */}
        <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <h2 className="mb-4 text-[15px] font-semibold text-foreground">
            Membres ({members.length})
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.id === user?.id}
                  canRemove={isAdmin && m.id !== user?.id}
                  onRemove={() => void handleRemove(m)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function MemberRow({
  member,
  isMe,
  canRemove,
  onRemove,
}: {
  member: Member;
  isMe: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const RoleIcon = ROLE_ICONS[member.role];
  const initials =
    (member.full_name ?? member.email)
      .split(" ")
      .map((s) => s[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?";

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[12px] font-semibold text-primary-foreground">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-foreground">
            {member.full_name ?? member.email.split("@")[0]}
          </p>
          {isMe && (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              Vous
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{member.email}</p>
        {member.job_title && (
          <p className="truncate text-[11px] text-muted-foreground/80">{member.job_title}</p>
        )}
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold",
          member.role === "admin" && "bg-primary/10 text-primary",
          member.role === "manager" && "bg-accent/10 text-accent",
          member.role === "user" && "bg-secondary text-foreground/70",
        )}
      >
        <RoleIcon className="h-3 w-3" />
        {ROLE_LABELS[member.role]}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          title="Retirer de l'équipe"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function InviteRow({
  invitation,
  canManage,
  onRevoke,
}: {
  invitation: Invitation;
  canManage: boolean;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/accept-invitation?token=${invitation.token}`
      : "";

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Lien copié");
    setTimeout(() => setCopied(false), 2000);
  };

  const expires = new Date(invitation.expires_at);
  const expired = expires < new Date();
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000));

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Mail className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-foreground">{invitation.email}</p>
        <p className="text-[11.5px] text-muted-foreground">
          {expired ? (
            <span className="text-destructive">Expirée</span>
          ) : (
            <>Expire dans {daysLeft} jour{daysLeft > 1 ? "s" : ""}</>
          )}
          {" · "}
          <span className="capitalize">{ROLE_LABELS[invitation.role]}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-secondary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copié" : "Copier le lien"}
      </button>
      {canManage && (
        <button
          type="button"
          onClick={onRevoke}
          className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          title="Révoquer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// silence unused import (Shield reserved for future)
void Shield;
