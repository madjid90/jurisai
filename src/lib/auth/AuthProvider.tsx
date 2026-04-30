import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      applyAuthState(newSession);
      setLoading(false);
    });

    // 2. Then check existing session
    void supabase.auth
      .getUser()
      .then(async ({ data: { user: existingUser }, error }) => {
        if (error || !existingUser) {
          applyAuthState(null);
          setLoading(false);
          return;
        }

        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();
        applyAuthState(existingSession ?? null);
        setLoading(false);
      })
      .catch(() => {
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
