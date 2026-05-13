// Hook React qui charge l'accès (rôles + permissions) de l'utilisateur courant.
// Source unique pour le filtrage UI par profil.
//
// Cache module-level partagé entre tous les composants qui appellent useAccess
// (AppShell, NotificationBell, GlobalSearch, etc.) pour éviter de relancer
// getMyAccess à chaque montage. Invalidation : changement d'utilisateur.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getMyAccess, type UserAccess } from "@/lib/auth/permissions.functions";
export type { UserAccess } from "@/lib/auth/access-types";

const EMPTY: UserAccess = {
  tenantId: "",
  roles: [],
  permissions: [],
  isSuperAdmin: false,
  isTenantAdmin: false,
};

type CacheEntry = {
  userId: string;
  access: UserAccess;
  inflight: Promise<UserAccess> | null;
  fetchedAt: number;
  unavailable?: boolean;
};
let cache: CacheEntry | null = null;
const TTL_MS = 60_000; // 1 min — suffit pour un parcours utilisateur normal
const subscribers = new Set<() => void>();

function isAuthServiceUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /AUTH_SERVICE_UNAVAILABLE/i.test(message);
}

function notify() {
  for (const fn of subscribers) fn();
}

async function loadAccess(userId: string): Promise<UserAccess> {
  const fresh = cache && cache.userId === userId && Date.now() - cache.fetchedAt < TTL_MS;
  if (fresh && cache) return cache.access;
  if (cache?.userId === userId && cache.inflight) return cache.inflight;

  const promise = (async () => {
    try {
      const res = (await getMyAccess()) as UserAccess;
      cache = { userId, access: res, inflight: null, fetchedAt: Date.now(), unavailable: false };
      notify();
      return res;
    } catch (err) {
      cache = {
        userId,
        access: EMPTY,
        inflight: null,
        fetchedAt: Date.now(),
        unavailable: isAuthServiceUnavailable(err),
      };
      notify();

      if (isAuthServiceUnavailable(err)) {
        return EMPTY;
      }

      throw err;
    }
  })();
  cache = {
    userId,
    access: cache?.access ?? EMPTY,
    inflight: promise,
    fetchedAt: 0,
    unavailable: cache?.unavailable ?? false,
  };
  return promise;
}

export function invalidateAccessCache() {
  cache = null;
  notify();
}

export function useAccess(): { access: UserAccess; loading: boolean; serviceUnavailable: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [, force] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const sub = () => {
      if (mountedRef.current) force((n) => n + 1);
    };
    subscribers.add(sub);
    return () => {
      mountedRef.current = false;
      subscribers.delete(sub);
    };
  }, []);

  useEffect(() => {
    if (authLoading || !user) {
      cache = null;
      return;
    }
    if (cache?.userId === user.id && Date.now() - cache.fetchedAt < TTL_MS) return;
    void loadAccess(user.id).catch(() => undefined);
  }, [authLoading, user]);

  if (authLoading) return { access: EMPTY, loading: true, serviceUnavailable: false };
  if (!user) return { access: EMPTY, loading: false, serviceUnavailable: false };
  if (cache?.userId === user.id && cache.fetchedAt > 0) {
    return {
      access: cache.access,
      loading: !!cache.inflight,
      serviceUnavailable: !!cache.unavailable,
    };
  }
  return { access: EMPTY, loading: true, serviceUnavailable: false };
}

export function hasAnyRole(access: UserAccess, roles: string[]): boolean {
  return roles.some((r) => access.roles.includes(r as never));
}

export function hasPermission(access: UserAccess, perm: string): boolean {
  return access.isSuperAdmin || access.permissions.includes(perm);
}
