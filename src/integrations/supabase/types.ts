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
      agent_memory: {
        Row: {
          created_at: string
          dossier_id: string | null
          expires_at: string | null
          id: string
          key: string
          relevance: number
          scope: string
          tenant_id: string
          updated_at: string
          user_id: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          dossier_id?: string | null
          expires_at?: string | null
          id?: string
          key: string
          relevance?: number
          scope?: string
          tenant_id: string
          updated_at?: string
          user_id?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          dossier_id?: string | null
          expires_at?: string | null
          id?: string
          key?: string
          relevance?: number
          scope?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
          value?: Json
        }
        Relationships: []
      }
      agent_post_checks: {
        Row: {
          agent_run_id: string | null
          created_at: string
          id: string
          missing_information: Json
          notes: string | null
          requires_validation: boolean
          rule_kind: string | null
          status: string
          tenant_id: string
          validation_roles: Json
        }
        Insert: {
          agent_run_id?: string | null
          created_at?: string
          id?: string
          missing_information?: Json
          notes?: string | null
          requires_validation?: boolean
          rule_kind?: string | null
          status?: string
          tenant_id: string
          validation_roles?: Json
        }
        Update: {
          agent_run_id?: string | null
          created_at?: string
          id?: string
          missing_information?: Json
          notes?: string | null
          requires_validation?: boolean
          rule_kind?: string | null
          status?: string
          tenant_id?: string
          validation_roles?: Json
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          answer: string | null
          archived_at: string | null
          confidence: number | null
          created_at: string
          domain: string | null
          dossier_id: string | null
          draft: Json
          duration_ms: number | null
          error_message: string | null
          executed_at: string | null
          final_document_ids: string[]
          id: string
          intent: string | null
          message: string
          missing_information: Json | null
          parent_run_id: string | null
          refusal_reason: string | null
          refused: boolean | null
          requires_document_upload: boolean | null
          requires_form: boolean | null
          requires_rag: boolean | null
          requires_validation: boolean | null
          sources: Json | null
          status: string
          suggested_actions: Json | null
          tenant_id: string
          title: string | null
          topic: string | null
          updated_at: string
          user_id: string
          workflow_instance_id: string | null
        }
        Insert: {
          answer?: string | null
          archived_at?: string | null
          confidence?: number | null
          created_at?: string
          domain?: string | null
          dossier_id?: string | null
          draft?: Json
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          final_document_ids?: string[]
          id?: string
          intent?: string | null
          message: string
          missing_information?: Json | null
          parent_run_id?: string | null
          refusal_reason?: string | null
          refused?: boolean | null
          requires_document_upload?: boolean | null
          requires_form?: boolean | null
          requires_rag?: boolean | null
          requires_validation?: boolean | null
          sources?: Json | null
          status?: string
          suggested_actions?: Json | null
          tenant_id: string
          title?: string | null
          topic?: string | null
          updated_at?: string
          user_id: string
          workflow_instance_id?: string | null
        }
        Update: {
          answer?: string | null
          archived_at?: string | null
          confidence?: number | null
          created_at?: string
          domain?: string | null
          dossier_id?: string | null
          draft?: Json
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          final_document_ids?: string[]
          id?: string
          intent?: string | null
          message?: string
          missing_information?: Json | null
          parent_run_id?: string | null
          refusal_reason?: string | null
          refused?: boolean | null
          requires_document_upload?: boolean | null
          requires_form?: boolean | null
          requires_rag?: boolean | null
          requires_validation?: boolean | null
          sources?: Json | null
          status?: string
          suggested_actions?: Json | null
          tenant_id?: string
          title?: string | null
          topic?: string | null
          updated_at?: string
          user_id?: string
          workflow_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_workflow_instance_id_fkey"
            columns: ["workflow_instance_id"]
            isOneToOne: false
            referencedRelation: "workflow_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_runs: {
        Row: {
          agent_run_id: string
          args: Json | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          is_sensitive: boolean | null
          result: Json | null
          succeeded: boolean | null
          tenant_id: string
          tool_name: string
          validation_request_id: string | null
        }
        Insert: {
          agent_run_id: string
          args?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          is_sensitive?: boolean | null
          result?: Json | null
          succeeded?: boolean | null
          tenant_id: string
          tool_name: string
          validation_request_id?: string | null
        }
        Update: {
          agent_run_id?: string
          args?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          is_sensitive?: boolean | null
          result?: Json | null
          succeeded?: boolean | null
          tenant_id?: string
          tool_name?: string
          validation_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_runs_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_runs_validation_request_id_fkey"
            columns: ["validation_request_id"]
            isOneToOne: false
            referencedRelation: "validation_requests"
            referencedColumns: ["id"]
          },
        ]
      }
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
      bareme_update_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_value: Json
          old_value: Json | null
          record_id: string
          source: string | null
          table_name: string
          updated_by: string
          verified: boolean | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_value: Json
          old_value?: Json | null
          record_id: string
          source?: string | null
          table_name: string
          updated_by: string
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_value?: Json
          old_value?: Json | null
          record_id?: string
          source?: string | null
          table_name?: string
          updated_by?: string
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
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
      business_rules: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_active: boolean
          is_sensitive: boolean
          keywords: Json
          kind: string
          required_fields: Json
          risks: Json
          steps: Json
          subtitle: string | null
          title: string
          updated_at: string
          validation_roles: Json
          validation_sla_days: number | null
        }
        Insert: {
          created_at?: string
          domain?: string
          id?: string
          is_active?: boolean
          is_sensitive?: boolean
          keywords?: Json
          kind: string
          required_fields?: Json
          risks?: Json
          steps?: Json
          subtitle?: string | null
          title: string
          updated_at?: string
          validation_roles?: Json
          validation_sla_days?: number | null
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_active?: boolean
          is_sensitive?: boolean
          keywords?: Json
          kind?: string
          required_fields?: Json
          risks?: Json
          steps?: Json
          subtitle?: string | null
          title?: string
          updated_at?: string
          validation_roles?: Json
          validation_sla_days?: number | null
        }
        Relationships: []
      }
      calculation_history: {
        Row: {
          baremes_used: Json | null
          calculation_type: string
          created_at: string | null
          dossier_id: string | null
          id: string
          input_params: Json
          legal_refs: string[] | null
          result_json: Json
          tenant_id: string
          user_id: string
        }
        Insert: {
          baremes_used?: Json | null
          calculation_type: string
          created_at?: string | null
          dossier_id?: string | null
          id?: string
          input_params: Json
          legal_refs?: string[] | null
          result_json: Json
          tenant_id: string
          user_id: string
        }
        Update: {
          baremes_used?: Json | null
          calculation_type?: string
          created_at?: string | null
          dossier_id?: string | null
          id?: string
          input_params?: Json
          legal_refs?: string[] | null
          result_json?: Json
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calculation_history_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calculation_history_tenant_id_fkey"
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
          message_created_at: string
          message_id: string
          rank: number
          score: number | null
          tenant_id: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          id?: string
          message_created_at: string
          message_id: string
          rank?: number
          score?: number | null
          tenant_id: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          id?: string
          message_created_at?: string
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
            foreignKeyName: "chat_citations_message_fkey"
            columns: ["message_id", "message_created_at"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "created_at"]
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
      contract_deadlines: {
        Row: {
          agent_run_id: string | null
          category: string | null
          created_at: string
          document_analysis_id: string | null
          done_at: string | null
          dossier_id: string | null
          due_date: string
          id: string
          label: string
          notes: string | null
          reminded_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          category?: string | null
          created_at?: string
          document_analysis_id?: string | null
          done_at?: string | null
          dossier_id?: string | null
          due_date: string
          id?: string
          label: string
          notes?: string | null
          reminded_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          category?: string | null
          created_at?: string
          document_analysis_id?: string | null
          done_at?: string | null
          dossier_id?: string | null
          due_date?: string
          id?: string
          label?: string
          notes?: string | null
          reminded_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_deadlines_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_deadlines_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_deadlines_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_deadlines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      convention_indemnity_scales: {
        Row: {
          category: string | null
          conditions_json: Json | null
          convention_name: string
          created_at: string | null
          formula_json: Json
          id: string
          idcc: string
          source_ref: string | null
          type: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          category?: string | null
          conditions_json?: Json | null
          convention_name: string
          created_at?: string | null
          formula_json: Json
          id?: string
          idcc: string
          source_ref?: string | null
          type: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          category?: string | null
          conditions_json?: Json | null
          convention_name?: string
          created_at?: string | null
          formula_json?: Json
          id?: string
          idcc?: string
          source_ref?: string | null
          type?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
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
      digest_runs: {
        Row: {
          created_at: string
          error: string | null
          frequency: string
          id: string
          items_count: number
          metadata: Json
          status: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          frequency: string
          id?: string
          items_count?: number
          metadata?: Json
          status?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          frequency?: string
          id?: string
          items_count?: number
          metadata?: Json
          status?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      document_analyses: {
        Row: {
          analysis: Json | null
          contract_data: Json
          created_at: string
          detected_dates: Json
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
          contract_data?: Json
          created_at?: string
          detected_dates?: Json
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
          contract_data?: Json
          created_at?: string
          detected_dates?: Json
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
          detected_risks: Json
          dossier_id: string | null
          id: string
          legal_sources_used: Json
          prefill_metadata: Json
          prefilled_data: Json
          reminder_after_days: number | null
          scenario: string
          status: string
          template_id: string | null
          tenant_id: string
          uncertain_fields: Json
          updated_at: string
          uploaded_document_analysis_id: string | null
          user_id: string
          validation_request_id: string | null
        }
        Insert: {
          collected_data?: Json
          created_at?: string
          current_step?: string | null
          detected_risks?: Json
          dossier_id?: string | null
          id?: string
          legal_sources_used?: Json
          prefill_metadata?: Json
          prefilled_data?: Json
          reminder_after_days?: number | null
          scenario?: string
          status?: string
          template_id?: string | null
          tenant_id: string
          uncertain_fields?: Json
          updated_at?: string
          uploaded_document_analysis_id?: string | null
          user_id: string
          validation_request_id?: string | null
        }
        Update: {
          collected_data?: Json
          created_at?: string
          current_step?: string | null
          detected_risks?: Json
          dossier_id?: string | null
          id?: string
          legal_sources_used?: Json
          prefill_metadata?: Json
          prefilled_data?: Json
          reminder_after_days?: number | null
          scenario?: string
          status?: string
          template_id?: string | null
          tenant_id?: string
          uncertain_fields?: Json
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
      document_links: {
        Row: {
          confidence: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          document_id: string
          dossier_id: string
          id: string
          link_method: string
          signals: Json
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          document_id: string
          dossier_id: string
          id?: string
          link_method: string
          signals?: Json
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          document_id?: string
          dossier_id?: string
          id?: string
          link_method?: string
          signals?: Json
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          archive_to_case: boolean
          body: string
          can_create_reminder: boolean
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          guidance: string | null
          icon: string | null
          id: string
          is_public: boolean
          legal_basis: Json
          name: string
          output_formats: string[]
          prefill_sources: Json
          reminder_days_default: number | null
          requires_form: boolean
          requires_rag: boolean
          requires_upload: boolean
          requires_validation: boolean
          risk_level: string
          slug: string | null
          status: Database["public"]["Enums"]["template_status"]
          tenant_id: string | null
          updated_at: string
          upload_optional: boolean
          validated_at: string | null
          validated_by: string | null
          validation_threshold: string
          variables: Json
          version: number
        }
        Insert: {
          archive_to_case?: boolean
          body: string
          can_create_reminder?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          guidance?: string | null
          icon?: string | null
          id?: string
          is_public?: boolean
          legal_basis?: Json
          name: string
          output_formats?: string[]
          prefill_sources?: Json
          reminder_days_default?: number | null
          requires_form?: boolean
          requires_rag?: boolean
          requires_upload?: boolean
          requires_validation?: boolean
          risk_level?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id?: string | null
          updated_at?: string
          upload_optional?: boolean
          validated_at?: string | null
          validated_by?: string | null
          validation_threshold?: string
          variables?: Json
          version?: number
        }
        Update: {
          archive_to_case?: boolean
          body?: string
          can_create_reminder?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          guidance?: string | null
          icon?: string | null
          id?: string
          is_public?: boolean
          legal_basis?: Json
          name?: string
          output_formats?: string[]
          prefill_sources?: Json
          reminder_days_default?: number | null
          requires_form?: boolean
          requires_rag?: boolean
          requires_upload?: boolean
          requires_validation?: boolean
          risk_level?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id?: string | null
          updated_at?: string
          upload_optional?: boolean
          validated_at?: string | null
          validated_by?: string | null
          validation_threshold?: string
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
          dossier_id: string | null
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
          dossier_id?: string | null
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
          dossier_id?: string | null
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
            foreignKeyName: "documents_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
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
      dossier_context_index: {
        Row: {
          content: string
          created_at: string
          dossier_id: string
          embedding: string | null
          id: string
          source_kind: string
          source_ref: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          dossier_id: string
          embedding?: string | null
          id?: string
          source_kind?: string
          source_ref?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          dossier_id?: string
          embedding?: string | null
          id?: string
          source_kind?: string
          source_ref?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_context_index_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_context_index_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_deadlines: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          created_by: string
          deadline_type: string | null
          description: string | null
          dossier_id: string
          due_date: string
          id: string
          source: string
          source_analysis_id: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by: string
          deadline_type?: string | null
          description?: string | null
          dossier_id: string
          due_date: string
          id?: string
          source?: string
          source_analysis_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string
          deadline_type?: string | null
          description?: string | null
          dossier_id?: string
          due_date?: string
          id?: string
          source?: string
          source_analysis_id?: string | null
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
      email_outbox: {
        Row: {
          attempts: number
          body_html: string | null
          body_text: string | null
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          sent_at: string | null
          status: string
          subject: string
          template: string | null
          template_data: Json
          tenant_id: string | null
          to_email: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          sent_at?: string | null
          status?: string
          subject: string
          template?: string | null
          template_data?: Json
          tenant_id?: string | null
          to_email: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          sent_at?: string | null
          status?: string
          subject?: string
          template?: string | null
          template_data?: Json
          tenant_id?: string | null
          to_email?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_tenant_id_fkey"
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
      employees: {
        Row: {
          contract_type: string | null
          created_at: string
          email: string | null
          end_date: string | null
          external_ref: string | null
          first_name: string
          id: string
          job_title: string | null
          last_name: string
          metadata: Json
          phone: string | null
          site_id: string | null
          start_date: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          contract_type?: string | null
          created_at?: string
          email?: string | null
          end_date?: string | null
          external_ref?: string | null
          first_name: string
          id?: string
          job_title?: string | null
          last_name: string
          metadata?: Json
          phone?: string | null
          site_id?: string | null
          start_date?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          contract_type?: string | null
          created_at?: string
          email?: string | null
          end_date?: string | null
          external_ref?: string | null
          first_name?: string
          id?: string
          job_title?: string | null
          last_name?: string
          metadata?: Json
          phone?: string | null
          site_id?: string | null
          start_date?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_mentions: {
        Row: {
          created_at: string
          document_id: string
          entity_type: string
          id: string
          metadata: Json
          normalized_value: string | null
          position_end: number | null
          position_start: number | null
          raw_value: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          entity_type: string
          id?: string
          metadata?: Json
          normalized_value?: string | null
          position_end?: number | null
          position_start?: number | null
          raw_value: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          normalized_value?: string | null
          position_end?: number | null
          position_start?: number | null
          raw_value?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          legal_sources: Json
          output_format: string
          reminder_id: string | null
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
          legal_sources?: Json
          output_format?: string
          reminder_id?: string | null
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
          legal_sources?: Json
          output_format?: string
          reminder_id?: string | null
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
      indemnity_formulas: {
        Row: {
          conditions_json: Json | null
          created_at: string | null
          formula_json: Json
          id: string
          label: string
          source_ref: string
          source_url: string | null
          type: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          conditions_json?: Json | null
          created_at?: string | null
          formula_json: Json
          id?: string
          label: string
          source_ref: string
          source_url?: string | null
          type: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          conditions_json?: Json | null
          created_at?: string | null
          formula_json?: Json
          id?: string
          label?: string
          source_ref?: string
          source_url?: string | null
          type?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      ingestion_batch_state: {
        Row: {
          articles_ingested: number
          articles_skipped_unchanged: number
          batch_type: string
          completed_at: string | null
          connector: string
          error_log: Json
          failed_count: number
          failed_items: Json
          id: string
          last_tick_at: string
          metadata: Json
          processed_count: number
          processed_items: Json
          started_at: string
          status: string
          total_count: number
          total_items: Json
        }
        Insert: {
          articles_ingested?: number
          articles_skipped_unchanged?: number
          batch_type: string
          completed_at?: string | null
          connector: string
          error_log?: Json
          failed_count?: number
          failed_items?: Json
          id?: string
          last_tick_at?: string
          metadata?: Json
          processed_count?: number
          processed_items?: Json
          started_at?: string
          status?: string
          total_count?: number
          total_items?: Json
        }
        Update: {
          articles_ingested?: number
          articles_skipped_unchanged?: number
          batch_type?: string
          completed_at?: string | null
          connector?: string
          error_log?: Json
          failed_count?: number
          failed_items?: Json
          id?: string
          last_tick_at?: string
          metadata?: Json
          processed_count?: number
          processed_items?: Json
          started_at?: string
          status?: string
          total_count?: number
          total_items?: Json
        }
        Relationships: []
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
            referencedRelation: "legal_reference_index"
            referencedColumns: ["source_id"]
          },
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
            referencedRelation: "legal_reference_index"
            referencedColumns: ["source_id"]
          },
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
            referencedRelation: "legal_reference_index"
            referencedColumns: ["source_id"]
          },
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
            referencedRelation: "legal_reference_index"
            referencedColumns: ["source_id"]
          },
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
            referencedRelation: "legal_reference_index"
            referencedColumns: ["source_id"]
          },
          {
            foreignKeyName: "legal_updates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      macron_scale: {
        Row: {
          company_size: string
          created_at: string | null
          id: string
          max_months: number
          min_months: number
          seniority_years: number
          source_ref: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          company_size?: string
          created_at?: string | null
          id?: string
          max_months: number
          min_months: number
          seniority_years: number
          source_ref?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          company_size?: string
          created_at?: string | null
          id?: string
          max_months?: number
          min_months?: number
          seniority_years?: number
          source_ref?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      message_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          message_created_at: string
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
          message_created_at: string
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
          message_created_at?: string
          message_id?: string
          rating?: number
          reason?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_message_fkey"
            columns: ["message_id", "message_created_at"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "created_at"]
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
            foreignKeyName: "messages_conversation_id_fkey1"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages_2026_01: {
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
        Relationships: []
      }
      messages_2026_02: {
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
        Relationships: []
      }
      messages_2026_03: {
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
        Relationships: []
      }
      messages_2026_04: {
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
        Relationships: []
      }
      messages_2026_05: {
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
        Relationships: []
      }
      messages_2026_06: {
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
        Relationships: []
      }
      messages_2026_07: {
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
        Relationships: []
      }
      messages_2026_08: {
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
        Relationships: []
      }
      messages_2026_09: {
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
        Relationships: []
      }
      messages_2026_10: {
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
        Relationships: []
      }
      messages_2026_11: {
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
        Relationships: []
      }
      messages_2026_12: {
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
        Relationships: []
      }
      messages_default: {
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
        Relationships: []
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
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_technical: boolean
          key: string
          label: string
          module: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_technical?: boolean
          key: string
          label: string
          module: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_technical?: boolean
          key?: string
          label?: string
          module?: string
        }
        Relationships: []
      }
      prescription_periods: {
        Row: {
          created_at: string | null
          duration_unit: string
          duration_value: number
          id: string
          label: string
          notes: string | null
          source_ref: string
          source_url: string | null
          starting_point: string
          type: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string | null
          duration_unit: string
          duration_value: number
          id?: string
          label: string
          notes?: string | null
          source_ref: string
          source_url?: string | null
          starting_point: string
          type: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string | null
          duration_unit?: string
          duration_value?: number
          id?: string
          label?: string
          notes?: string | null
          source_ref?: string
          source_url?: string | null
          starting_point?: string
          type?: string
          valid_from?: string
          valid_to?: string | null
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
          answer_correctness: number | null
          case_id: string
          citation_coverage: number | null
          hallucination_detected: boolean | null
          id: string
          latency_ms: number | null
          model: string | null
          mrr: number | null
          notes: string | null
          precision_at_5: number | null
          ran_at: string
          refusal_quality: number | null
          retrieval_accuracy: number | null
          retrieved_sources: string[] | null
          source_authority_score: number | null
          user_feedback_score: number | null
        }
        Insert: {
          answer?: string | null
          answer_correctness?: number | null
          case_id: string
          citation_coverage?: number | null
          hallucination_detected?: boolean | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          mrr?: number | null
          notes?: string | null
          precision_at_5?: number | null
          ran_at?: string
          refusal_quality?: number | null
          retrieval_accuracy?: number | null
          retrieved_sources?: string[] | null
          source_authority_score?: number | null
          user_feedback_score?: number | null
        }
        Update: {
          answer?: string | null
          answer_correctness?: number | null
          case_id?: string
          citation_coverage?: number | null
          hallucination_detected?: boolean | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          mrr?: number | null
          notes?: string | null
          precision_at_5?: number | null
          ran_at?: string
          refusal_quality?: number | null
          retrieval_accuracy?: number | null
          retrieved_sources?: string[] | null
          source_authority_score?: number | null
          user_feedback_score?: number | null
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
      rag_response_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          hit_count: number
          payload: Json
          question: string
          tenant_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          hit_count?: number
          payload: Json
          question: string
          tenant_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          hit_count?: number
          payload?: Json
          question?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rag_response_cache_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      reference_values: {
        Row: {
          created_at: string | null
          id: string
          key: string
          label: string
          source_ref: string | null
          source_url: string | null
          unit: string
          updated_at: string | null
          updated_by: string | null
          valid_from: string
          valid_to: string | null
          value: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          label: string
          source_ref?: string | null
          source_url?: string | null
          unit?: string
          updated_at?: string | null
          updated_by?: string | null
          valid_from: string
          valid_to?: string | null
          value: number
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          label?: string
          source_ref?: string | null
          source_url?: string | null
          unit?: string
          updated_at?: string | null
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
          value?: number
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
      rgpd_requests: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          kind: string
          metadata: Json
          requested_at: string
          status: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          kind: string
          metadata?: Json
          requested_at?: string
          status?: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          metadata?: Json
          requested_at?: string
          status?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          granted?: boolean
          id?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      sensitive_actions_catalog: {
        Row: {
          action_key: string
          action_label: string
          created_at: string
          description: string | null
          domain: string
          id: string
          keywords: string[]
          legal_refs: Json
          requires_human_validation: boolean
          requires_lawyer: boolean
          severity: string
          updated_at: string
        }
        Insert: {
          action_key: string
          action_label: string
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          keywords?: string[]
          legal_refs?: Json
          requires_human_validation?: boolean
          requires_lawyer?: boolean
          severity?: string
          updated_at?: string
        }
        Update: {
          action_key?: string
          action_label?: string
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          keywords?: string[]
          legal_refs?: Json
          requires_human_validation?: boolean
          requires_lawyer?: boolean
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      server_function_errors: {
        Row: {
          context: Json
          created_at: string
          error_message: string
          error_stack: string | null
          function_name: string
          id: string
          severity: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          error_message: string
          error_stack?: string | null
          function_name: string
          id?: string
          severity?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          error_message?: string
          error_stack?: string | null
          function_name?: string
          id?: string
          severity?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
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
          secret_last4: string | null
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
          secret_last4?: string | null
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
          secret_last4?: string | null
          target_url?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          chat_model: string
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
          chat_model?: string
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
          chat_model?: string
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
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_04: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_05: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_06: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_07: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_08: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_09: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_10: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_11: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2026_12: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2027_01: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2027_02: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2027_03: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2027_04: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_2027_05: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_logs_part_default: {
        Row: {
          action: string
          cost_cents: number | null
          created_at: string
          id: string
          metadata: Json
          tenant_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_cents?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
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
      workflow_audit_log: {
        Row: {
          action: string
          actor_role: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          retention_until: string
          tenant_id: string
          user_agent: string | null
          user_id: string | null
          workflow_definition_id: string | null
          workflow_instance_id: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          retention_until?: string
          tenant_id: string
          user_agent?: string | null
          user_id?: string | null
          workflow_definition_id?: string | null
          workflow_instance_id?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          retention_until?: string
          tenant_id?: string
          user_agent?: string | null
          user_id?: string | null
          workflow_definition_id?: string | null
          workflow_instance_id?: string | null
        }
        Relationships: []
      }
      workflow_definitions: {
        Row: {
          category: string
          contains_sensitive_actions: boolean
          created_at: string
          description: string | null
          estimated_duration_days: number | null
          generated_by_ai: boolean
          generation_run_id: string | null
          id: string
          legal_refs: Json
          lifecycle_status: Database["public"]["Enums"]["workflow_lifecycle_status"]
          llm_model: string | null
          rejected_reason: string | null
          requires_human_review: boolean
          requires_sourcing: boolean
          score_completeness: number | null
          score_documents: number | null
          score_legal_refs: number | null
          score_logic: number | null
          score_overall: number | null
          score_safety: number | null
          sensitive_actions_detected: Json
          slug: string
          source_chunk_ids: Json
          status: Database["public"]["Enums"]["template_status"]
          steps: Json
          tenant_id: string | null
          title: string
          topic_embedding: string | null
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          version: number
        }
        Insert: {
          category: string
          contains_sensitive_actions?: boolean
          created_at?: string
          description?: string | null
          estimated_duration_days?: number | null
          generated_by_ai?: boolean
          generation_run_id?: string | null
          id?: string
          legal_refs?: Json
          lifecycle_status?: Database["public"]["Enums"]["workflow_lifecycle_status"]
          llm_model?: string | null
          rejected_reason?: string | null
          requires_human_review?: boolean
          requires_sourcing?: boolean
          score_completeness?: number | null
          score_documents?: number | null
          score_legal_refs?: number | null
          score_logic?: number | null
          score_overall?: number | null
          score_safety?: number | null
          sensitive_actions_detected?: Json
          slug: string
          source_chunk_ids?: Json
          status?: Database["public"]["Enums"]["template_status"]
          steps?: Json
          tenant_id?: string | null
          title: string
          topic_embedding?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          version?: number
        }
        Update: {
          category?: string
          contains_sensitive_actions?: boolean
          created_at?: string
          description?: string | null
          estimated_duration_days?: number | null
          generated_by_ai?: boolean
          generation_run_id?: string | null
          id?: string
          legal_refs?: Json
          lifecycle_status?: Database["public"]["Enums"]["workflow_lifecycle_status"]
          llm_model?: string | null
          rejected_reason?: string | null
          requires_human_review?: boolean
          requires_sourcing?: boolean
          score_completeness?: number | null
          score_documents?: number | null
          score_legal_refs?: number | null
          score_logic?: number | null
          score_overall?: number | null
          score_safety?: number | null
          sensitive_actions_detected?: Json
          slug?: string
          source_chunk_ids?: Json
          status?: Database["public"]["Enums"]["template_status"]
          steps?: Json
          tenant_id?: string | null
          title?: string
          topic_embedding?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_definitions_generation_run_fk"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_generation_runs: {
        Row: {
          cache_hit: boolean
          category: string | null
          completed_at: string | null
          created_at: string
          domain: string | null
          duplicate_of_definition_id: string | null
          duration_ms: number | null
          error_message: string | null
          generated_definition_id: string | null
          id: string
          llm_model: string | null
          prompt: string
          scores: Json
          sources_used: Json
          status: string
          tenant_id: string
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          cache_hit?: boolean
          category?: string | null
          completed_at?: string | null
          created_at?: string
          domain?: string | null
          duplicate_of_definition_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          generated_definition_id?: string | null
          id?: string
          llm_model?: string | null
          prompt: string
          scores?: Json
          sources_used?: Json
          status?: string
          tenant_id: string
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          cache_hit?: boolean
          category?: string | null
          completed_at?: string | null
          created_at?: string
          domain?: string | null
          duplicate_of_definition_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          generated_definition_id?: string | null
          id?: string
          llm_model?: string | null
          prompt?: string
          scores?: Json
          sources_used?: Json
          status?: string
          tenant_id?: string
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_generation_runs_duplicate_of_definition_id_fkey"
            columns: ["duplicate_of_definition_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_generation_runs_generated_definition_id_fkey"
            columns: ["generated_definition_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_instances: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string | null
          completed_at: string | null
          context: Json
          created_at: string
          current_step_index: number
          definition_id: string
          dossier_id: string | null
          id: string
          started_at: string | null
          started_by: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string
          current_step_index?: number
          definition_id: string
          dossier_id?: string | null
          id?: string
          started_at?: string | null
          started_by: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string
          current_step_index?: number
          definition_id?: string
          dossier_id?: string | null
          id?: string
          started_at?: string | null
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
      workflow_quality_checks: {
        Row: {
          check_type: string
          created_at: string
          details: Json
          generation_run_id: string
          id: string
          passed: boolean
          score: number | null
          workflow_definition_id: string | null
        }
        Insert: {
          check_type: string
          created_at?: string
          details?: Json
          generation_run_id: string
          id?: string
          passed: boolean
          score?: number | null
          workflow_definition_id?: string | null
        }
        Update: {
          check_type?: string
          created_at?: string
          details?: Json
          generation_run_id?: string
          id?: string
          passed?: boolean
          score?: number | null
          workflow_definition_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_quality_checks_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_quality_checks_workflow_definition_id_fkey"
            columns: ["workflow_definition_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_step_runs: {
        Row: {
          created_at: string
          delay_calculation: Json
          due_at: string | null
          executed_at: string | null
          executed_by: string | null
          generated_document_id: string | null
          id: string
          idempotency_key: string | null
          instance_id: string
          legal_sources: Json
          notes: string | null
          output: Json | null
          requires_validation: boolean
          status: string
          step_definition: Json
          step_index: number
          step_key: string
          validation_request_id: string | null
        }
        Insert: {
          created_at?: string
          delay_calculation?: Json
          due_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          generated_document_id?: string | null
          id?: string
          idempotency_key?: string | null
          instance_id: string
          legal_sources?: Json
          notes?: string | null
          output?: Json | null
          requires_validation?: boolean
          status?: string
          step_definition?: Json
          step_index: number
          step_key: string
          validation_request_id?: string | null
        }
        Update: {
          created_at?: string
          delay_calculation?: Json
          due_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          generated_document_id?: string | null
          id?: string
          idempotency_key?: string | null
          instance_id?: string
          legal_sources?: Json
          notes?: string | null
          output?: Json | null
          requires_validation?: boolean
          status?: string
          step_definition?: Json
          step_index?: number
          step_key?: string
          validation_request_id?: string | null
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
          {
            foreignKeyName: "workflow_step_runs_validation_request_id_fkey"
            columns: ["validation_request_id"]
            isOneToOne: false
            referencedRelation: "validation_requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      legal_reference_index: {
        Row: {
          idcc: string | null
          official_url: string | null
          reference_code: string | null
          reference_norm: string | null
          source_id: string | null
          source_type: string | null
          title: string | null
        }
        Insert: {
          idcc?: string | null
          official_url?: string | null
          reference_code?: string | null
          reference_norm?: never
          source_id?: string | null
          source_type?: string | null
          title?: string | null
        }
        Update: {
          idcc?: string | null
          official_url?: string | null
          reference_code?: string | null
          reference_norm?: never
          source_id?: string | null
          source_type?: string | null
          title?: string | null
        }
        Relationships: []
      }
      v_ingestion_progress: {
        Row: {
          articles_ingested: number | null
          articles_skipped_unchanged: number | null
          batch_id: string | null
          batch_type: string | null
          connector: string | null
          elapsed_sec: number | null
          estimated_remaining_sec: number | null
          failed_count: number | null
          last_tick_at: string | null
          metadata: Json | null
          percent_complete: number | null
          processed_count: number | null
          started_at: string | null
          status: string | null
          total_count: number | null
        }
        Insert: {
          articles_ingested?: number | null
          articles_skipped_unchanged?: number | null
          batch_id?: string | null
          batch_type?: string | null
          connector?: string | null
          elapsed_sec?: never
          estimated_remaining_sec?: never
          failed_count?: number | null
          last_tick_at?: string | null
          metadata?: Json | null
          percent_complete?: never
          processed_count?: number | null
          started_at?: string | null
          status?: string | null
          total_count?: number | null
        }
        Update: {
          articles_ingested?: number | null
          articles_skipped_unchanged?: number | null
          batch_id?: string | null
          batch_type?: string | null
          connector?: string | null
          elapsed_sec?: never
          estimated_remaining_sec?: never
          failed_count?: number | null
          last_tick_at?: string | null
          metadata?: Json | null
          percent_complete?: never
          processed_count?: number | null
          started_at?: string | null
          status?: string | null
          total_count?: number | null
        }
        Relationships: []
      }
      v_legal_chunks_summary: {
        Row: {
          avg_chunk_size: number | null
          chunks_count: number | null
          connector: string | null
          embedded_chunks: number | null
          missing_embeddings: number | null
          source_type: string | null
          sources_count: number | null
        }
        Relationships: []
      }
      v_legal_sources_summary: {
        Row: {
          active_sources: number | null
          connector: string | null
          distinct_codes: number | null
          distinct_idcc: number | null
          first_ingested: string | null
          hashed_sources: number | null
          inactive_sources: number | null
          last_update: string | null
          source_type: string | null
          total_sources: number | null
        }
        Relationships: []
      }
      v_source_types_health: {
        Row: {
          active_rows: number | null
          avg_authority: number | null
          max_authority: number | null
          min_authority: number | null
          rows_count: number | null
          source_type: string | null
        }
        Relationships: []
      }
      v_workflow_audit_stats: {
        Row: {
          action: string | null
          distinct_users: number | null
          event_count: number | null
          month: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_workflow_definitions_health: {
        Row: {
          avg_quality: number | null
          generated_by: string | null
          sensitive_count: number | null
          status: string | null
          workflows_count: number | null
        }
        Relationships: []
      }
      v_workflow_generator_stats: {
        Row: {
          avg_duration_ms: number | null
          avg_quality_score: number | null
          completed: number | null
          day: string | null
          failed: number | null
          from_cache: number | null
          rejected: number | null
          total_runs: number | null
          total_tokens: number | null
        }
        Relationships: []
      }
      v_workflow_overdue_steps: {
        Row: {
          days_overdue: number | null
          dossier_id: string | null
          due_at: string | null
          instance_id: string | null
          instance_title: string | null
          requires_validation: boolean | null
          status: string | null
          step_index: number | null
          step_key: string | null
          step_run_id: string | null
          tenant_id: string | null
        }
        Relationships: [
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
          {
            foreignKeyName: "workflow_step_runs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "workflow_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      v_workflow_runtime_health: {
        Row: {
          active_count: number | null
          blocked_for_validation: number | null
          cancelled_count: number | null
          completed_30d: number | null
          overdue_instances: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      append_batch_items: {
        Args: { p_batch_id: string; p_items: Json }
        Returns: undefined
      }
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
      cleanup_zombie_batches: { Args: never; Returns: number }
      count_empty_sources_by_connector: {
        Args: never
        Returns: {
          connector: string
          count: number
        }[]
      }
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
      ensure_messages_partition: {
        Args: { p_month?: string }
        Returns: undefined
      }
      ensure_usage_logs_partition: {
        Args: { p_month?: string }
        Returns: undefined
      }
      finalize_batch: { Args: { p_batch_id: string }; Returns: Json }
      get_applicable_formula: {
        Args: {
          p_category?: string
          p_date?: string
          p_idcc?: string
          p_type: string
        }
        Returns: {
          conditions: Json
          formula: Json
          ref: string
          source: string
        }[]
      }
      get_data_quality_snapshot: { Args: never; Returns: Json }
      get_macron_scale: {
        Args: {
          p_company_size?: string
          p_date?: string
          p_seniority_years: number
        }
        Returns: {
          max_months: number
          min_months: number
        }[]
      }
      get_next_batch_items: {
        Args: { p_batch_id: string; p_limit?: number }
        Returns: Json
      }
      get_reference_value: {
        Args: { p_date?: string; p_key: string }
        Returns: number
      }
      has_permission: {
        Args: { _permission_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role_any_tenant: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat_batch: { Args: { p_batch_id: string }; Returns: undefined }
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
      increment_embedding_cache_hit: {
        Args: { _query_hash: string }
        Returns: undefined
      }
      increment_questions_used: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      increment_rag_cache_hit: { Args: { _key: string }; Returns: undefined }
      is_member_of_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      list_empty_sources: {
        Args: { p_connector: string }
        Returns: {
          external_id: string
          official_url: string
          raw_metadata: Json
          source_id: string
        }[]
      }
      log_server_error: {
        Args: {
          _context: Json
          _error_message: string
          _error_stack: string
          _function_name: string
          _severity: string
          _tenant_id: string
          _user_id: string
        }
        Returns: string
      }
      mark_items_failed: {
        Args: {
          p_batch_id: string
          p_error_message: string
          p_failed_items: Json
        }
        Returns: undefined
      }
      mark_items_processed: {
        Args: {
          p_articles_ingested?: number
          p_articles_skipped?: number
          p_batch_id: string
          p_processed_items: Json
        }
        Returns: undefined
      }
      match_dossier_context: {
        Args: {
          p_embedding: string
          p_match_count?: number
          p_min_score?: number
          p_tenant_id: string
        }
        Returns: {
          best_score: number
          dossier_id: string
          matched_content: string
          source_kind: string
        }[]
      }
      match_workflow_definitions: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          tenant_id_filter?: string
        }
        Returns: {
          category: string
          description: string
          id: string
          lifecycle_status: string
          similarity: number
          slug: string
          title: string
        }[]
      }
      promote_ingestion_job: { Args: { p_job_id: string }; Returns: Json }
      purge_expired_rag_cache: { Args: never; Returns: number }
      purge_expired_workflow_audit: { Args: never; Returns: number }
      run_data_quality_checks: { Args: never; Returns: undefined }
      start_ingestion_batch: {
        Args: {
          p_batch_type: string
          p_connector: string
          p_items: Json
          p_metadata?: Json
        }
        Returns: string
      }
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
        | "rh"
      plan_type: "starter" | "pro" | "business"
      template_status: "draft" | "review" | "validated" | "deprecated"
      user_profile_kind:
        | "dirigeant"
        | "rh"
        | "juriste"
        | "expert_comptable"
        | "manager_multi_sites"
      workflow_lifecycle_status:
        | "draft_ai"
        | "ai_validated_auto"
        | "pending_human_review"
        | "human_validated"
        | "rejected"
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
        "rh",
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
      workflow_lifecycle_status: [
        "draft_ai",
        "ai_validated_auto",
        "pending_human_review",
        "human_validated",
        "rejected",
      ],
    },
  },
} as const
