// Types Supabase manuels pour Phase 1.
// À terme, régénérer avec :
// npx supabase gen types typescript --project-id yuvysjsyumxpekzvlzsx > src/integrations/supabase/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole =
  | "admin"
  | "manager"
  | "user"
  | "super_admin"
  | "operationnel_terrain"
  | "comptable"
  | "daf"
  | "dirigeant"
  | "juriste"
  | "avocat_partenaire"
  | "cabinet_comptable_admin"
  | "collaborateur_cabinet"
  | "admin_tenant"
  | "rh";
export type PlanType = "starter" | "pro" | "business";

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          siret: string | null;
          idcc: string | null;
          sector: string | null;
          plan: PlanType;
          quota_questions: number;
          questions_used: number;
          quota_reset_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          siret?: string | null;
          idcc?: string | null;
          sector?: string | null;
          plan?: PlanType;
          quota_questions?: number;
          questions_used?: number;
          quota_reset_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tenants"]["Insert"]>;
      };
      profiles: {
        Row: {
          id: string;
          tenant_id: string | null;
          email: string;
          full_name: string | null;
          job_title: string | null;
          phone: string | null;
          avatar_url: string | null;
          onboarded: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id?: string | null;
          email: string;
          full_name?: string | null;
          job_title?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          onboarded?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          tenant_id: string;
          role: AppRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tenant_id: string;
          role: AppRole;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_roles"]["Insert"]>;
      };
      invitations: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          role: AppRole;
          invited_by: string;
          token: string;
          accepted_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          role?: AppRole;
          invited_by: string;
          token?: string;
          accepted_at?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invitations"]["Insert"]>;
      };
      usage_logs: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          action: string;
          tokens_used: number | null;
          cost_cents: number | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          action: string;
          tokens_used?: number | null;
          cost_cents?: number | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["usage_logs"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      has_role: {
        Args: { _user_id: string; _role: AppRole; _tenant_id: string };
        Returns: boolean;
      };
      current_tenant_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_member_of_tenant: {
        Args: { _user_id: string; _tenant_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: AppRole;
      plan_type: PlanType;
    };
  };
}
