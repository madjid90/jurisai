import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/database.types";
import { invalidateAccessCache } from "@/lib/auth/useAccess";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

function isTransientAuthError(error: unknown) {
  if (!error) return false;

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: string }).message)
        : String(error);

  return (
    (typeof status === "number" && status >= 500) ||
    /unexpected eof|failed to fetch|network|timeout|temporarily unavailable|service unavailable|schema cache|database client error|no connection to the server/i.test(
      message,
    )
  );
}

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const validatedUserIdRef = useRef<string | null>(null);

  const applyAuthState = (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    validatedUserIdRef.current = nextSession?.user?.id ?? null;
    invalidateAccessCache();
    if (nextSession?.user) {
      setTimeout(() => {
        void fetchProfile(nextSession.user.id);
      }, 0);
    } else {
      setProfile(null);
    }
  };

  const fetchProfile = async (userId: string, attempt = 0): Promise<void> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    // Audit fix : retry transient au lieu d'avaler silencieusement.
    // Avant : 1 erreur réseau → profile reste null → _authenticated.tsx déclenchait
    // signOut → user dégagé en plein workflow.
    if (error && isTransientAuthError(error)) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        return fetchProfile(userId, attempt + 1);
      }
      // Après 3 retries, on garde le profile actuel et on log au lieu de wipe.
      console.warn("[AuthProvider] fetchProfile transient error persistant:", error);
      return;
    }

    // Erreur non-transient (RLS refuse, etc.) : on log mais on ne wipe pas non plus
    // pour éviter signOut intempestif. Le user peut continuer sa session.
    if (error) {
      console.error("[AuthProvider] fetchProfile error:", error);
      return;
    }

    setProfile((data as Profile | null) ?? null);
  };

  useEffect(() => {
    // 1. Subscribe FIRST (per Supabase guidance)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const nextUserId = newSession?.user?.id ?? null;

      if (!nextUserId) {
        validatedUserIdRef.current = null;
        applyAuthState(null);
        setLoading(false);
        return;
      }

      if (validatedUserIdRef.current === nextUserId) {
        applyAuthState(newSession);
        setLoading(false);
        return;
      }

      queueMicrotask(() => {
        void (async () => {
          try {
            const {
              data: { user: verifiedUser },
              error,
            } = await supabase.auth.getUser();

            if (error && isTransientAuthError(error)) {
              applyAuthState(newSession);
              setLoading(false);
              return;
            }

            if (error || !verifiedUser || verifiedUser.id !== nextUserId) {
              validatedUserIdRef.current = null;
              applyAuthState(null);
              setLoading(false);
              return;
            }

            validatedUserIdRef.current = verifiedUser.id;
            const {
              data: { session: verifiedSession },
            } = await supabase.auth.getSession();
            applyAuthState(verifiedSession ?? newSession);
          } catch {
            validatedUserIdRef.current = null;
            applyAuthState(null);
          } finally {
            setLoading(false);
          }
        })();
      });
    });

    // 2. Then check existing session
    void supabase.auth
      .getUser()
      .then(async ({ data: { user: existingUser }, error }) => {
        if (error && isTransientAuthError(error)) {
          const {
            data: { session: existingSession },
          } = await supabase.auth.getSession();

          validatedUserIdRef.current = existingSession?.user?.id ?? null;
          applyAuthState(existingSession ?? null);
          setLoading(false);
          return;
        }

        if (error || !existingUser) {
          validatedUserIdRef.current = null;
          applyAuthState(null);
          setLoading(false);
          return;
        }

        validatedUserIdRef.current = existingUser.id;

        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();
        applyAuthState(existingSession ?? null);
        setLoading(false);
      })
      .catch(() => {
        validatedUserIdRef.current = null;
        applyAuthState(null);
        setLoading(false);
      });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    invalidateAccessCache();
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
