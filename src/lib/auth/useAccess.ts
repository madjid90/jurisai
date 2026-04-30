// Hook React qui charge l'accès (rôles + permissions) de l'utilisateur courant.
// Source unique pour le filtrage UI par profil.
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getMyAccess, type UserAccess } from "@/server/permissions.functions";

const EMPTY: UserAccess = {
  tenantId: "",
  roles: [],
  permissions: [],
  isSuperAdmin: false,
  isTenantAdmin: false,
};

export function useAccess(): { access: UserAccess; loading: boolean } {
  const { user } = useAuth();
  const [access, setAccess] = useState<UserAccess>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAccess(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMyAccess()
      .then((res) => {
        if (!cancelled) setAccess(res as UserAccess);
      })
      .catch(() => {
        if (!cancelled) setAccess(EMPTY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { access, loading };
}

export function hasAnyRole(access: UserAccess, roles: string[]): boolean {
  return roles.some((r) => access.roles.includes(r as never));
}

export function hasPermission(access: UserAccess, perm: string): boolean {
  return access.isSuperAdmin || access.permissions.includes(perm);
}
