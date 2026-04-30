export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_dismissals: {
        Row: {
          alert_id: string
          dismissed_at: string
          id: string
          user_id: string
        }
        Insert: {
          alert_id: string
          dismissed_at?: string
          id?: string
          user_id: string
        }
        Update: {
          alert_id?: string
          dismissed_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_dismissals_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "legal_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          api_key_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          tenant_id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          api_key_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          tenant_id: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          api_key_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          tenant_id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "tenant_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string | null
          event_type: string
          id: string
          metadata: Json
          stripe_event_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          event_type: string
          id?: string
          metadata?: Json
          stripe_event_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          stripe_event_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      case_timeline_events: {
        Row: {
          actor_id: string | null
          created_at: string
          description: string | null
          dossier_id: string
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          tenant_id: string
          title: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          description?: string | null
          dossier_id: string
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          tenant_id: string
          title: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          description?: string | null
          dossier_id?: string
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_timeline_events_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_citations: {
        Row: {
          chunk_id: string
          created_at: string
          id: string
          message_id: string
          rank: number
          score: number | null
          tenant_id: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          id?: string
          message_id: string
          rank?: number
          score?: number | null
          tenant_id: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          id?: string
          message_id?: string
          rank?: number
          score?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_citations_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "legal_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_citations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contract_type: string | null
          created_at: string
          created_by: string
          email: string | null
          full_name: string
          hire_date: string | null
          id: string
          job_title: string | null
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contract_type?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          full_name: string
          hire_date?: string | null
          id?: string
          job_title?: string | null
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contract_type?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          full_name?: string
          hire_date?: string | null
          id?: string
          job_title?: string | null
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conventions_collectives: {
        Row: {
          brochure: string | null
          created_at: string
          effectif: number | null
          id: string
          idcc: string
          is_active: boolean | null
          is_extended: boolean | null
          last_synced_at: string | null
          naf_codes: string[] | null
          raw_metadata: Json | null
          short_title: string | null
          source_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          brochure?: string | null
          created_at?: string
          effectif?: number | null
          id?: string
          idcc: string
          is_active?: boolean | null
          is_extended?: boolean | null
          last_synced_at?: string | null
          naf_codes?: string[] | null
          raw_metadata?: Json | null
          short_title?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          brochure?: string | null
          created_at?: string
          effectif?: number | null
          id?: string
          idcc?: string
          is_active?: boolean | null
          is_extended?: boolean | null
          last_synced_at?: string | null
          naf_codes?: string[] | null
          raw_metadata?: Json | null
          short_title?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      data_quality_checks: {
        Row: {
          check_name: string
          details: Json
          id: string
          metric_value: number | null
          ran_at: string
          status: string
          threshold: number | null
        }
        Insert: {
          check_name: string
          details?: Json
          id?: string
          metric_value?: number | null
          ran_at?: string
          status: string
          threshold?: number | null
        }
        Update: {
          check_name?: string
          details?: Json
          id?: string
          metric_value?: number | null
          ran_at?: string
          status?: string
          threshold?: number | null
        }
        Relationships: []
      }
      document_analyses: {
        Row: {
          analysis: Json | null
          created_at: string
          dossier_id: string | null
          error_message: string | null
          extracted_text: string | null
          file_size: number
          file_type: string
          filename: string
          id: string
          status: string
          storage_path: string | null
          tenant_id: string
          tokens_used: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis?: Json | null
          created_at?: string
          dossier_id?: string | null
          error_message?: string | null
          extracted_text?: string | null
          file_size: number
          file_type: string
          filename: string
          id?: string
          status?: string
          storage_path?: string | null
          tenant_id: string
          tokens_used?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis?: Json | null
          created_at?: string
          dossier_id?: string | null
          error_message?: string | null
          extracted_text?: string | null
          file_size?: number
          file_type?: string
          filename?: string
          id?: string
          status?: string
          storage_path?: string | null
          tenant_id?: string
          tokens_used?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_analyses_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_analyses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_generation_sessions: {
        Row: {
          collected_data: Json
          created_at: string
          current_step: string | null
          dossier_id: string | null
          id: string
          prefilled_data: Json
          scenario: string
          status: string
          template_id: string | null
          tenant_id: string
          updated_at: string
          uploaded_document_analysis_id: string | null
          user_id: string
          validation_request_id: string | null
        }
        Insert: {
          collected_data?: Json
          created_at?: string
          current_step?: string | null
          dossier_id?: string | null
          id?: string
          prefilled_data?: Json
          scenario?: string
          status?: string
          template_id?: string | null
          tenant_id: string
          updated_at?: string
          uploaded_document_analysis_id?: string | null
          user_id: string
          validation_request_id?: string | null
        }
        Update: {
          collected_data?: Json
          created_at?: string
          current_step?: string | null
          dossier_id?: string | null
          id?: string
          prefilled_data?: Json
          scenario?: string
          status?: string
          template_id?: string | null
          tenant_id?: string
          updated_at?: string
          uploaded_document_analysis_id?: string | null
          user_id?: string
          validation_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_generation_sessions_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_generation_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_generation_sessions_uploaded_document_analysis_id_fkey"
            columns: ["uploaded_document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_public: boolean
          legal_basis: Json
          name: string
          risk_level: string
          slug: string | null
          status: Database["public"]["Enums"]["template_status"]
          tenant_id: string | null
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          variables: Json
          version: number
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_public?: boolean
          legal_basis?: Json
          name: string
          risk_level?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          variables?: Json
          version?: number
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_public?: boolean
          legal_basis?: Json
          name?: string
          risk_level?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content: string
          created_at: string
          id: string
          status: string
          template_id: string | null
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
          variables: Json | null
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          status?: string
          template_id?: string | null
          tenant_id: string
          title?: string
          updated_at?: string
          user_id: string
          variables?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          status?: string
          template_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_comments: {
        Row: {
          body: string
          created_at: string
          dossier_id: string
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          dossier_id: string
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          dossier_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dossier_deadlines: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          dossier_id: string
          due_date: string
          id: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          dossier_id: string
          due_date: string
          id?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          dossier_id?: string
          due_date?: string
          id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_deadlines_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_deadlines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          dossier_id: string
          due_date: string | null
          id: string
          priority: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          dossier_id: string
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          dossier_id?: string
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      dossiers: {
        Row: {
          category: string
          client_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          risk_level: string
          site_id: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          client_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          risk_level?: string
          site_id?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          client_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          risk_level?: string
          site_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossiers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_queue: {
        Row: {
          attempts: number
          body_html: string
          body_text: string | null
          created_at: string
          id: string
          last_error: string | null
          metadata: Json
          recipient_email: string
          recipient_user_id: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          subject: string
          template_key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          body_html: string
          body_text?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json
          recipient_email: string
          recipient_user_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject: string
          template_key: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          body_html?: string
          body_text?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json
          recipient_email?: string
          recipient_user_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject?: string
          template_key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      embedding_cache: {
        Row: {
          created_at: string
          embedding: string
          hit_count: number
          last_hit_at: string
          query_hash: string
        }
        Insert: {
          created_at?: string
          embedding: string
          hit_count?: number
          last_hit_at?: string
          query_hash: string
        }
        Update: {
          created_at?: string
          embedding?: string
          hit_count?: number
          last_hit_at?: string
          query_hash?: string
        }
        Relationships: []
      }
      extracted_fields: {
        Row: {
          confidence: number | null
          created_at: string
          document_analysis_id: string
          field_key: string
          field_type: string
          field_value: string | null
          id: string
          page_number: number | null
          source_excerpt: string | null
          tenant_id: string
          validated_by_user: boolean
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          document_analysis_id: string
          field_key: string
          field_type?: string
          field_value?: string | null
          id?: string
          page_number?: number | null
          source_excerpt?: string | null
          tenant_id: string
          validated_by_user?: boolean
        }
        Update: {
          confidence?: number | null
          created_at?: string
          document_analysis_id?: string
          field_key?: string
          field_type?: string
          field_value?: string | null
          id?: string
          page_number?: number | null
          source_excerpt?: string | null
          tenant_id?: string
          validated_by_user?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "extracted_fields_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          content_html: string | null
          content_markdown: string | null
          created_at: string
          dossier_id: string | null
          generated_by: string
          id: string
          output_format: string
          session_id: string | null
          status: string
          storage_path: string | null
          template_id: string | null
          tenant_id: string
          title: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          variables_used: Json
        }
        Insert: {
          content_html?: string | null
          content_markdown?: string | null
          created_at?: string
          dossier_id?: string | null
          generated_by: string
          id?: string
          output_format?: string
          session_id?: string | null
          status?: string
          storage_path?: string | null
          template_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          variables_used?: Json
        }
        Update: {
          content_html?: string | null
          content_markdown?: string | null
          created_at?: string
          dossier_id?: string | null
          generated_by?: string
          id?: string
          output_format?: string
          session_id?: string | null
          status?: string
          storage_path?: string | null
          template_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          variables_used?: Json
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "document_generation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      identified_risks: {
        Row: {
          category: string
          created_at: string
          description: string | null
          detected_by: string
          dossier_id: string
          id: string
          legal_basis: Json
          mitigation: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          detected_by: string
          dossier_id: string
          id?: string
          legal_basis?: Json
          mitigation?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          detected_by?: string
          dossier_id?: string
          id?: string
          legal_basis?: Json
          mitigation?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "identified_risks_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_errors: {
        Row: {
          connector: string
          created_at: string
          error_message: string
          error_type: string
          external_id: string | null
          id: string
          job_id: string | null
          payload: Json | null
          resolved: boolean | null
          retry_count: number | null
        }
        Insert: {
          connector: string
          created_at?: string
          error_message: string
          error_type: string
          external_id?: string | null
          id?: string
          job_id?: string | null
          payload?: Json | null
          resolved?: boolean | null
          retry_count?: number | null
        }
        Update: {
          connector?: string
          created_at?: string
          error_message?: string
          error_type?: string
          external_id?: string | null
          id?: string
          job_id?: string | null
          payload?: Json | null
          resolved?: boolean | null
          retry_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_errors_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          chunks_created: number
          completed_at: string | null
          connector: string | null
          created_at: string
          error_message: string | null
          id: string
          input_url: string | null
          items_failed: number | null
          items_processed: number | null
          items_total: number | null
          job_type: string
          params: Json | null
          source_id: string | null
          status: string
          triggered_by: string | null
        }
        Insert: {
          chunks_created?: number
          completed_at?: string | null
          connector?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_url?: string | null
          items_failed?: number | null
          items_processed?: number | null
          items_total?: number | null
          job_type: string
          params?: Json | null
          source_id?: string | null
          status?: string
          triggered_by?: string | null
        }
        Update: {
          chunks_created?: number
          completed_at?: string | null
          connector?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_url?: string | null
          items_failed?: number | null
          items_processed?: number | null
          items_total?: number | null
          job_type?: string
          params?: Json | null
          source_id?: string | null
          status?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_alerts: {
        Row: {
          change_type: string
          created_at: string
          id: string
          idcc: string | null
          legal_date: string | null
          metadata: Json
          official_url: string | null
          severity: string
          source_id: string | null
          source_type: string | null
          summary: string | null
          title: string
        }
        Insert: {
          change_type?: string
          created_at?: string
          id?: string
          idcc?: string | null
          legal_date?: string | null
          metadata?: Json
          official_url?: string | null
          severity?: string
          source_id?: string | null
          source_type?: string | null
          summary?: string | null
          title: string
        }
        Update: {
          change_type?: string
          created_at?: string
          id?: string
          idcc?: string | null
          legal_date?: string | null
          metadata?: Json
          official_url?: string | null
          severity?: string
          source_id?: string | null
          source_type?: string | null
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_alerts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_article_versions: {
        Row: {
          content: string
          created_at: string
          diff_summary: string | null
          id: string
          is_current: boolean
          reference_code: string
          source_id: string
          version_date: string
        }
        Insert: {
          content: string
          created_at?: string
          diff_summary?: string | null
          id?: string
          is_current?: boolean
          reference_code: string
          source_id: string
          version_date: string
        }
        Update: {
          content?: string
          created_at?: string
          diff_summary?: string | null
          id?: string
          is_current?: boolean
          reference_code?: string
          source_id?: string
          version_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_article_versions_source_fk"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          fts: unknown
          heading: string | null
          id: string
          source_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          fts?: unknown
          heading?: string | null
          id?: string
          source_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          fts?: unknown
          heading?: string | null
          id?: string
          source_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_chunks_staging: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          embedding: string | null
          heading: string | null
          id: string
          job_id: string
          source_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          embedding?: string | null
          heading?: string | null
          id?: string
          job_id: string
          source_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          embedding?: string | null
          heading?: string | null
          id?: string
          job_id?: string
          source_id?: string
          token_count?: number | null
        }
        Relationships: []
      }
      legal_sources: {
        Row: {
          authority_level: number
          connector: string | null
          created_at: string
          created_by: string | null
          external_id: string | null
          id: string
          idcc: string | null
          is_active: boolean
          last_quality_check_at: string | null
          last_synced_at: string | null
          legal_date: string | null
          metadata: Json
          official_url: string | null
          quality_score: number | null
          raw_metadata: Json | null
          reference_code: string | null
          source_type: string
          title: string
          updated_at: string
          version_date: string | null
        }
        Insert: {
          authority_level?: number
          connector?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          idcc?: string | null
          is_active?: boolean
          last_quality_check_at?: string | null
          last_synced_at?: string | null
          legal_date?: string | null
          metadata?: Json
          official_url?: string | null
          quality_score?: number | null
          raw_metadata?: Json | null
          reference_code?: string | null
          source_type: string
          title: string
          updated_at?: string
          version_date?: string | null
        }
        Update: {
          authority_level?: number
          connector?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          idcc?: string | null
          is_active?: boolean
          last_quality_check_at?: string | null
          last_synced_at?: string | null
          legal_date?: string | null
          metadata?: Json
          official_url?: string | null
          quality_score?: number | null
          raw_metadata?: Json | null
          reference_code?: string | null
          source_type?: string
          title?: string
          updated_at?: string
          version_date?: string | null
        }
        Relationships: []
      }
      legal_update_actions: {
        Row: {
          action_type: string
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          id: string
          legal_update_id: string
          metadata: Json
          related_dossier_id: string | null
          status: string
          tenant_id: string
          triggered_by: string
          updated_at: string
        }
        Insert: {
          action_type: string
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          legal_update_id: string
          metadata?: Json
          related_dossier_id?: string | null
          status?: string
          tenant_id: string
          triggered_by: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          legal_update_id?: string
          metadata?: Json
          related_dossier_id?: string | null
          status?: string
          tenant_id?: string
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_update_actions_legal_update_id_fkey"
            columns: ["legal_update_id"]
            isOneToOne: false
            referencedRelation: "legal_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_update_actions_related_dossier_id_fkey"
            columns: ["related_dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_updates: {
        Row: {
          created_at: string
          domain: string
          effective_date: string | null
          full_text: string | null
          id: string
          impacted_document_types: string[] | null
          impacted_workflow_slugs: string[] | null
          practical_impact: string | null
          publication_date: string | null
          recommended_actions: Json
          source_id: string | null
          source_url: string | null
          summary: string
          title: string
          updated_at: string
          urgency: string
          who_is_concerned: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          effective_date?: string | null
          full_text?: string | null
          id?: string
          impacted_document_types?: string[] | null
          impacted_workflow_slugs?: string[] | null
          practical_impact?: string | null
          publication_date?: string | null
          recommended_actions?: Json
          source_id?: string | null
          source_url?: string | null
          summary: string
          title: string
          updated_at?: string
          urgency?: string
          who_is_concerned?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          effective_date?: string | null
          full_text?: string | null
          id?: string
          impacted_document_types?: string[] | null
          impacted_workflow_slugs?: string[] | null
          practical_impact?: string | null
          publication_date?: string | null
          recommended_actions?: Json
          source_id?: string | null
          source_url?: string | null
          summary?: string
          title?: string
          updated_at?: string
          urgency?: string
          who_is_concerned?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_updates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      message_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          message_id: string
          rating: number
          reason: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          message_id: string
          rating: number
          reason?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          message_id?: string
          rating?: number
          reason?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_message_fk"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_feedback_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tokens_used: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tokens_used?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          app_enabled: boolean
          created_at: string
          digest_frequency: string
          email_enabled: boolean
          notify_on: Json
          tenant_id: string
          updated_at: string
          user_id: string
          watched_client_ids: string[]
          watched_domains: string[]
          watched_site_ids: string[]
          watched_update_types: string[]
        }
        Insert: {
          app_enabled?: boolean
          created_at?: string
          digest_frequency?: string
          email_enabled?: boolean
          notify_on?: Json
          tenant_id: string
          updated_at?: string
          user_id: string
          watched_client_ids?: string[]
          watched_domains?: string[]
          watched_site_ids?: string[]
          watched_update_types?: string[]
        }
        Update: {
          app_enabled?: boolean
          created_at?: string
          digest_frequency?: string
          email_enabled?: boolean
          notify_on?: Json
          tenant_id?: string
          updated_at?: string
          user_id?: string
          watched_client_ids?: string[]
          watched_domains?: string[]
          watched_site_ids?: string[]
          watched_update_types?: string[]
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          metadata: Json
          read_at: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          job_title: string | null
          onboarded: boolean
          phone: string | null
          preferred_rag_mode: string | null
          profile_kind: Database["public"]["Enums"]["user_profile_kind"] | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          job_title?: string | null
          onboarded?: boolean
          phone?: string | null
          preferred_rag_mode?: string | null
          profile_kind?: Database["public"]["Enums"]["user_profile_kind"] | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          job_title?: string | null
          onboarded?: boolean
          phone?: string | null
          preferred_rag_mode?: string | null
          profile_kind?: Database["public"]["Enums"]["user_profile_kind"] | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_eval_cases: {
        Row: {
          active: boolean
          category: string
          created_at: string
          difficulty: string
          expected_answer_keywords: string[]
          expected_sources: string[]
          id: string
          idcc: string | null
          question: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          difficulty?: string
          expected_answer_keywords?: string[]
          expected_sources?: string[]
          id?: string
          idcc?: string | null
          question: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          difficulty?: string
          expected_answer_keywords?: string[]
          expected_sources?: string[]
          id?: string
          idcc?: string | null
          question?: string
        }
        Relationships: []
      }
      rag_eval_runs: {
        Row: {
          answer: string | null
          case_id: string
          hallucination_detected: boolean | null
          id: string
          latency_ms: number | null
          model: string | null
          mrr: number | null
          precision_at_5: number | null
          ran_at: string
          retrieved_sources: string[] | null
        }
        Insert: {
          answer?: string | null
          case_id: string
          hallucination_detected?: boolean | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          mrr?: number | null
          precision_at_5?: number | null
          ran_at?: string
          retrieved_sources?: string[] | null
        }
        Update: {
          answer?: string | null
          case_id?: string
          hallucination_detected?: boolean | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          mrr?: number | null
          precision_at_5?: number | null
          ran_at?: string
          retrieved_sources?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_eval_runs_case_fk"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "rag_eval_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          request_count?: number
          user_id: string
          window_start: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          body: string | null
          created_at: string
          created_by: string
          dismissed_at: string | null
          dossier_id: string | null
          id: string
          metadata: Json
          remind_at: string
          sent_at: string | null
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by: string
          dismissed_at?: string | null
          dossier_id?: string | null
          id?: string
          metadata?: Json
          remind_at: string
          sent_at?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string
          dismissed_at?: string | null
          dossier_id?: string | null
          id?: string
          metadata?: Json
          remind_at?: string
          sent_at?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      report_exports: {
        Row: {
          created_at: string
          exported_by: string
          format: string
          id: string
          metadata: Json
          recipient_email: string | null
          report_id: string
          shared_expires_at: string | null
          shared_token: string | null
          storage_path: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          exported_by: string
          format: string
          id?: string
          metadata?: Json
          recipient_email?: string | null
          report_id: string
          shared_expires_at?: string | null
          shared_token?: string | null
          storage_path?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          exported_by?: string
          format?: string
          id?: string
          metadata?: Json
          recipient_email?: string | null
          report_id?: string
          shared_expires_at?: string | null
          shared_token?: string | null
          storage_path?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_exports_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          client_id: string | null
          context: string | null
          created_at: string
          data: Json
          dossier_id: string | null
          executive_summary: string | null
          generated_by: string
          id: string
          period_end: string | null
          period_start: string | null
          report_type: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          context?: string | null
          created_at?: string
          data?: Json
          dossier_id?: string | null
          executive_summary?: string | null
          generated_by: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          report_type: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          context?: string | null
          created_at?: string
          data?: Json
          dossier_id?: string | null
          executive_summary?: string | null
          generated_by?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          report_type?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          city: string | null
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          manager_user_id: string | null
          metadata: Json
          name: string
          postal_code: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          manager_user_id?: string | null
          metadata?: Json
          name: string
          postal_code?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          manager_user_id?: string | null
          metadata?: Json
          name?: string
          postal_code?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_metrics: {
        Row: {
          id: string
          metric_name: string
          metric_value: number
          recorded_at: string
          tags: Json
        }
        Insert: {
          id?: string
          metric_name: string
          metric_value: number
          recorded_at?: string
          tags?: Json
        }
        Update: {
          id?: string
          metric_name?: string
          metric_value?: number
          recorded_at?: string
          tags?: Json
        }
        Relationships: []
      }
      templates_public: {
        Row: {
          category: string
          content_md: string
          created_at: string
          description: string | null
          disclaimer: string | null
          external_id: string
          id: string
          last_synced_at: string | null
          legal_basis: string[] | null
          quality_level: string | null
          source_url: string | null
          title: string
          updated_at: string
          variables: Json | null
        }
        Insert: {
          category: string
          content_md: string
          created_at?: string
          description?: string | null
          disclaimer?: string | null
          external_id: string
          id?: string
          last_synced_at?: string | null
          legal_basis?: string[] | null
          quality_level?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          variables?: Json | null
        }
        Update: {
          category?: string
          content_md?: string
          created_at?: string
          description?: string | null
          disclaimer?: string | null
          external_id?: string
          id?: string
          last_synced_at?: string | null
          legal_basis?: string[] | null
          quality_level?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          variables?: Json | null
        }
        Relationships: []
      }
      tenant_alert_subscriptions: {
        Row: {
          created_at: string
          email_enabled: boolean
          frequency: string
          id: string
          idcc_filters: string[]
          severity_min: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          frequency?: string
          id?: string
          idcc_filters?: string[]
          severity_min?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          frequency?: string
          id?: string
          idcc_filters?: string[]
          severity_min?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_api_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key_hash: string
          label: string
          last_used_at: string | null
          prefix: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          label: string
          last_used_at?: string | null
          prefix: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          label?: string
          last_used_at?: string | null
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
        }
        Relationships: []
      }
      tenant_integrations: {
        Row: {
          calendar_token: string
          slack_channel: string | null
          slack_enabled: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          calendar_token?: string
          slack_channel?: string | null
          slack_enabled?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          calendar_token?: string
          slack_channel?: string | null
          slack_enabled?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_webhooks: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          events: string[]
          id: string
          secret: string
          target_url: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          events?: string[]
          id?: string
          secret: string
          target_url: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          events?: string[]
          id?: string
          secret?: string
          target_url?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          idcc: string | null
          name: string
          plan: Database["public"]["Enums"]["plan_type"]
          questions_used: number
          quota_questions: number
          quota_reset_at: string
          rag_mode: string | null
          sector: string | null
          siret: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          idcc?: string | null
          name: string
          plan?: Database["public"]["Enums"]["plan_type"]
          questions_used?: number
          quota_questions?: number
          quota_reset_at?: string
          rag_mode?: string | null
          sector?: string | null
          siret?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          idcc?: string | null
          name?: string
          plan?: Database["public"]["Enums"]["plan_type"]
          questions_used?: number
          quota_questions?: number
          quota_reset_at?: string
          rag_mode?: string | null
          sector?: string | null
          siret?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      usage_logs: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json | null
          tenant_id: string
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json | null
          tenant_id: string
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json | null
          tenant_id?: string
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_requests: {
        Row: {
          assigned_to: string
          comment: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_comment: string | null
          dossier_id: string | null
          id: string
          requested_by: string
          status: string
          subject_id: string | null
          subject_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_comment?: string | null
          dossier_id?: string | null
          id?: string
          requested_by: string
          status?: string
          subject_id?: string | null
          subject_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_comment?: string | null
          dossier_id?: string | null
          id?: string
          requested_by?: string
          status?: string
          subject_id?: string | null
          subject_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_requests_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempted_at: string
          error: string | null
          event: string
          id: string
          payload: Json
          response_code: number | null
          status: string
          tenant_id: string
          webhook_id: string
        }
        Insert: {
          attempted_at?: string
          error?: string | null
          event: string
          id?: string
          payload?: Json
          response_code?: number | null
          status: string
          tenant_id: string
          webhook_id: string
        }
        Update: {
          attempted_at?: string
          error?: string | null
          event?: string
          id?: string
          payload?: Json
          response_code?: number | null
          status?: string
          tenant_id?: string
          webhook_id?: string
        }
        Relationships: []
      }
      workflow_definitions: {
        Row: {
          category: string
          created_at: string
          description: string | null
          estimated_duration_days: number | null
          id: string
          legal_refs: Json
          slug: string
          status: Database["public"]["Enums"]["template_status"]
          steps: Json
          tenant_id: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          estimated_duration_days?: number | null
          id?: string
          legal_refs?: Json
          slug: string
          status?: Database["public"]["Enums"]["template_status"]
          steps?: Json
          tenant_id?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          estimated_duration_days?: number | null
          id?: string
          legal_refs?: Json
          slug?: string
          status?: Database["public"]["Enums"]["template_status"]
          steps?: Json
          tenant_id?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_instances: {
        Row: {
          client_id: string | null
          completed_at: string | null
          context: Json
          created_at: string
          current_step_index: number
          definition_id: string
          dossier_id: string | null
          id: string
          started_by: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string
          current_step_index?: number
          definition_id: string
          dossier_id?: string | null
          id?: string
          started_by: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string
          current_step_index?: number
          definition_id?: string
          dossier_id?: string | null
          id?: string
          started_by?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_instances_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_instances_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_step_runs: {
        Row: {
          created_at: string
          executed_at: string | null
          executed_by: string | null
          generated_document_id: string | null
          id: string
          instance_id: string
          notes: string | null
          output: Json | null
          status: string
          step_index: number
          step_key: string
        }
        Insert: {
          created_at?: string
          executed_at?: string | null
          executed_by?: string | null
          generated_document_id?: string | null
          id?: string
          instance_id: string
          notes?: string | null
          output?: Json | null
          status?: string
          step_index: number
          step_key: string
        }
        Update: {
          created_at?: string
          executed_at?: string | null
          executed_by?: string | null
          generated_document_id?: string | null
          id?: string
          instance_id?: string
          notes?: string | null
          output?: Json | null
          status?: string
          step_index?: number
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_step_runs_generated_document_id_fkey"
            columns: ["generated_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_step_runs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "workflow_instances"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_endpoint: string
          p_max_per_minute?: number
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          current_count: number
          reset_at: string
        }[]
      }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      create_notification: {
        Args: {
          _body?: string
          _kind: string
          _link?: string
          _metadata?: Json
          _tenant_id: string
          _title: string
          _user_id: string
        }
        Returns: string
      }
      current_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      hybrid_search: {
        Args: {
          idcc_filter?: string
          match_count?: number
          query_embedding: string
          query_text: string
          rrf_k?: number
        }
        Returns: {
          chunk_id: string
          content: string
          embedding: string
          heading: string
          official_url: string
          reference_code: string
          score: number
          source_id: string
          source_title: string
          source_type: string
        }[]
      }
      increment_questions_used: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      is_member_of_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      promote_ingestion_job: { Args: { p_job_id: string }; Returns: Json }
      run_data_quality_checks: { Args: never; Returns: undefined }
      validate_api_key: {
        Args: { _key_hash: string }
        Returns: {
          api_key_id: string
          scopes: string[]
          tenant_id: string
        }[]
      }
    }
    Enums: {
      app_role:
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
      plan_type: "starter" | "pro" | "business"
      template_status: "draft" | "review" | "validated" | "deprecated"
      user_profile_kind:
        | "dirigeant"
        | "rh"
        | "juriste"
        | "expert_comptable"
        | "manager_multi_sites"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "user",
        "super_admin",
        "operationnel_terrain",
        "comptable",
        "daf",
        "dirigeant",
        "juriste",
        "avocat_partenaire",
        "cabinet_comptable_admin",
        "collaborateur_cabinet",
        "admin_tenant",
      ],
      plan_type: ["starter", "pro", "business"],
      template_status: ["draft", "review", "validated", "deprecated"],
      user_profile_kind: [
        "dirigeant",
        "rh",
        "juriste",
        "expert_comptable",
        "manager_multi_sites",
      ],
    },
  },
} as const
