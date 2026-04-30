import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/database.types";
import { invalidateAccessCache } from "@/lib/auth/useAccess";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

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
    invalidateAccessCache();
    if (nextSession?.user) {
      setTimeout(() => {
        void fetchProfile(nextSession.user.id);
      }, 0);
    } else {
      setProfile(null);
    }
  };

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
  };

  useEffect(() => {
    // 1. Subscribe FIRST (per Supabase guidance)
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
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

      try {
        const {
          data: { user: verifiedUser },
          error,
        } = await supabase.auth.getUser();

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
    });

    // 2. Then check existing session
    void supabase.auth
      .getUser()
      .then(async ({ data: { user: existingUser }, error }) => {
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
