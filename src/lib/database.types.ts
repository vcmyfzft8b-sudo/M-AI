export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type MobileEntitlementRow = {
  id: string; user_id: string; product_id: string; transaction_id: string;
  original_transaction_id: string; environment: "production" | "sandbox";
  status: "active" | "expired" | "revoked" | "pending_verification";
  purchased_at: string | null; expires_at: string | null; revoked_at: string | null;
  signed_transaction_jws: string; raw_payload: Json; created_at: string; updated_at: string;
};

export type LectureStatus =
  | "uploading"
  | "queued"
  | "transcribing"
  | "generating_notes"
  | "ready"
  | "failed";

export type StudyAssetStatus =
  | "queued"
  | "generating"
  | "ready"
  | "failed";

export type FlashcardDifficulty = "easy" | "medium" | "hard";
export type FlashcardConfidenceBucket = "again" | "good" | "easy";

export type AdminRole = "owner" | "admin";

export type UgcPlatform = "tiktok" | "instagram" | "youtube";
export type UgcStatus = "active" | "paused" | "archived";
/** `owned` is the brand's own account, kept countable but separable. */
export type UgcCreatorKind = "creator" | "owned";
export type UgcContentMode = "dedicated" | "mixed" | "personal";
export type UgcClassification = "memo" | "personal" | "unknown";
export type UgcClassificationSource = "manual" | "account_default" | "rule" | "ai";
export type UgcRuleKind = "keyword" | "hashtag" | "mention" | "link";
export type UgcRateKind =
  | "per_video"
  | "per_month"
  | "per_1k_views"
  | "revenue_share";

export type SiteDeviceType = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

export interface Citation {
  idx: number;
  startMs: number;
  endMs: number;
  quote: string;
}

export type Database = {
  public: {
    Tables: {
      apple_auth_grants: {
        Row: { user_id: string; client_id: string; apple_subject: string; refresh_token_encrypted: string; updated_at: string };
        Insert: { user_id: string; client_id: string; apple_subject: string; refresh_token_encrypted: string; updated_at?: string };
        Update: { apple_subject?: string; refresh_token_encrypted?: string; updated_at?: string };
      };
      account_deletion_requests: {
        Row: { user_id: string; requested_at: string; cleanup_after: string; failure_lecture_ids: string[] };
        Insert: { user_id: string; requested_at?: string; cleanup_after?: string; failure_lecture_ids?: string[] };
        Update: { requested_at?: string; cleanup_after?: string; failure_lecture_ids?: string[] };
      };
      mobile_app_store_entitlements: {
        Row: MobileEntitlementRow;
        Insert: Omit<MobileEntitlementRow, "id" | "created_at" | "updated_at"> & Partial<Pick<MobileEntitlementRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<MobileEntitlementRow>;
      };
      ai_usage_events: {
        Row: {
          id: string;
          created_at: string;
          user_id: string | null;
          lecture_id: string | null;
          provider: string;
          model: string;
          stage: string;
          attempt_index: number;
          success: boolean;
          prompt_token_count: number | null;
          candidates_token_count: number | null;
          thoughts_token_count: number | null;
          total_token_count: number | null;
          estimated_cost_usd: number | null;
          error_code: string | null;
          error_message: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          user_id?: string | null;
          lecture_id?: string | null;
          provider: string;
          model: string;
          stage: string;
          attempt_index?: number;
          success?: boolean;
          prompt_token_count?: number | null;
          candidates_token_count?: number | null;
          thoughts_token_count?: number | null;
          total_token_count?: number | null;
          estimated_cost_usd?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
        };
        Update: {
          user_id?: string | null;
          lecture_id?: string | null;
          provider?: string;
          model?: string;
          stage?: string;
          attempt_index?: number;
          success?: boolean;
          prompt_token_count?: number | null;
          candidates_token_count?: number | null;
          thoughts_token_count?: number | null;
          total_token_count?: number | null;
          estimated_cost_usd?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
        };
      };
      email_auth_requests: {
        Row: {
          id: number;
          email: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          email: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          email?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
          updated_at: string;
          onboarding_completed_at: string | null;
          age_range: string | null;
          education_level: string | null;
          current_average_grade: string | null;
          target_grade: string | null;
          study_goal: string | null;
          onboarding_heard_from: string | null;
          onboarding_audience: string | null;
          onboarding_role: string | null;
          onboarding_school_level: string | null;
          onboarding_school_year: string | null;
          onboarding_subject: string | null;
          onboarding_motivation: string | null;
          onboarding_feature: string | null;
          onboarding_class_focus: string | null;
          onboarding_daily_goal: string | null;
          onboarding_current_average_grade: number | null;
          onboarding_target_grade: number | null;
          onboarding_grade_scale: number | null;
          stripe_customer_id: string | null;
          subscription_trial_started_at: string | null;
          trial_lecture_id: string | null;
          trial_started_at: string | null;
          trial_consumed_at: string | null;
          discount_wheel_spun_at: string | null;
          discount_wheel_coupon: string | null;
          discount_wheel_redeemed_at: string | null;
          install_guide_seen_at: string | null;
          ui_language: string | null;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
          onboarding_completed_at?: string | null;
          age_range?: string | null;
          education_level?: string | null;
          current_average_grade?: string | null;
          target_grade?: string | null;
          study_goal?: string | null;
          onboarding_heard_from?: string | null;
          onboarding_audience?: string | null;
          onboarding_role?: string | null;
          onboarding_school_level?: string | null;
          onboarding_school_year?: string | null;
          onboarding_subject?: string | null;
          onboarding_motivation?: string | null;
          onboarding_feature?: string | null;
          onboarding_class_focus?: string | null;
          onboarding_daily_goal?: string | null;
          onboarding_current_average_grade?: number | null;
          onboarding_target_grade?: number | null;
          onboarding_grade_scale?: number | null;
          stripe_customer_id?: string | null;
          subscription_trial_started_at?: string | null;
          trial_lecture_id?: string | null;
          trial_started_at?: string | null;
          trial_consumed_at?: string | null;
          discount_wheel_spun_at?: string | null;
          discount_wheel_coupon?: string | null;
          discount_wheel_redeemed_at?: string | null;
          install_guide_seen_at?: string | null;
          ui_language?: string | null;
        };
        Update: {
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
          onboarding_completed_at?: string | null;
          age_range?: string | null;
          education_level?: string | null;
          current_average_grade?: string | null;
          target_grade?: string | null;
          study_goal?: string | null;
          onboarding_heard_from?: string | null;
          onboarding_audience?: string | null;
          onboarding_role?: string | null;
          onboarding_school_level?: string | null;
          onboarding_school_year?: string | null;
          onboarding_subject?: string | null;
          onboarding_motivation?: string | null;
          onboarding_feature?: string | null;
          onboarding_class_focus?: string | null;
          onboarding_daily_goal?: string | null;
          onboarding_current_average_grade?: number | null;
          onboarding_target_grade?: number | null;
          onboarding_grade_scale?: number | null;
          stripe_customer_id?: string | null;
          subscription_trial_started_at?: string | null;
          trial_lecture_id?: string | null;
          trial_started_at?: string | null;
          trial_consumed_at?: string | null;
          discount_wheel_spun_at?: string | null;
          discount_wheel_coupon?: string | null;
          discount_wheel_redeemed_at?: string | null;
          install_guide_seen_at?: string | null;
          ui_language?: string | null;
        };
      };
      billing_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string;
          stripe_price_id: string | null;
          plan: "weekly" | "monthly" | "yearly";
          status:
            | "incomplete"
            | "incomplete_expired"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          currency: string;
          unit_amount: number | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id: string;
          stripe_price_id?: string | null;
          plan: "weekly" | "monthly" | "yearly";
          status:
            | "incomplete"
            | "incomplete_expired"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          currency?: string;
          unit_amount?: number | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string;
          stripe_price_id?: string | null;
          plan?: "weekly" | "monthly" | "yearly";
          status?:
            | "incomplete"
            | "incomplete_expired"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          currency?: string;
          unit_amount?: number | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      lectures: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          emoji: string | null;
          source_type: string;
          access_tier: "paid" | "trial";
          storage_path: string | null;
          processing_metadata: Json;
          duration_seconds: number | null;
          status: LectureStatus;
          language_hint: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          emoji?: string | null;
          source_type: string;
          access_tier?: "paid" | "trial";
          storage_path?: string | null;
          processing_metadata?: Json;
          duration_seconds?: number | null;
          status?: LectureStatus;
          language_hint?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string | null;
          emoji?: string | null;
          source_type?: string;
          access_tier?: "paid" | "trial";
          storage_path?: string | null;
          processing_metadata?: Json;
          duration_seconds?: number | null;
          status?: LectureStatus;
          language_hint?: string | null;
          error_message?: string | null;
          updated_at?: string;
        };
      };
      library_folders: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          updated_at?: string;
        };
      };
      library_folder_lectures: {
        Row: {
          folder_id: string;
          lecture_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          folder_id: string;
          lecture_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          folder_id?: string;
          lecture_id?: string;
          user_id?: string;
          created_at?: string;
        };
      };
      transcript_segments: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          start_ms: number;
          end_ms: number;
          speaker_label: string | null;
          text: string;
          embedding: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          start_ms: number;
          end_ms: number;
          speaker_label?: string | null;
          text: string;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          idx?: number;
          start_ms?: number;
          end_ms?: number;
          speaker_label?: string | null;
          text?: string;
          embedding?: string | null;
        };
      };
      lecture_artifacts: {
        Row: {
          lecture_id: string;
          summary: string;
          key_topics: string[];
          structured_notes_md: string;
          editable_notes_doc: Json | null;
          editable_notes_md: string | null;
          editable_notes_plain: string | null;
          editable_notes_revision: number;
          editable_notes_updated_at: string | null;
          model_metadata: Json;
          generated_at: string;
          tutor_plan: Json | null;
          tutor_plan_notes_hash: string | null;
          tutor_plan_generated_at: string | null;
        };
        Insert: {
          lecture_id: string;
          summary: string;
          key_topics: string[];
          structured_notes_md: string;
          editable_notes_doc?: Json | null;
          editable_notes_md?: string | null;
          editable_notes_plain?: string | null;
          editable_notes_revision?: number;
          editable_notes_updated_at?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          tutor_plan?: Json | null;
          tutor_plan_notes_hash?: string | null;
          tutor_plan_generated_at?: string | null;
        };
        Update: {
          summary?: string;
          key_topics?: string[];
          structured_notes_md?: string;
          editable_notes_doc?: Json | null;
          editable_notes_md?: string | null;
          editable_notes_plain?: string | null;
          editable_notes_revision?: number;
          editable_notes_updated_at?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          tutor_plan?: Json | null;
          tutor_plan_notes_hash?: string | null;
          tutor_plan_generated_at?: string | null;
        };
      };
      note_generation_cache: {
        Row: {
          lecture_id: string;
          stage: string;
          cache_key: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          lecture_id: string;
          stage: string;
          cache_key: string;
          payload: Json;
          created_at?: string;
        };
        Update: {
          payload?: Json;
          created_at?: string;
        };
      };
      admin_impersonation_events: {
        Row: {
          id: string;
          admin_email: string | null;
          target_user_id: string;
          target_email: string | null;
          user_agent: string | null;
          started_at: string;
        };
        Insert: {
          id?: string;
          admin_email?: string | null;
          target_user_id: string;
          target_email?: string | null;
          user_agent?: string | null;
          started_at?: string;
        };
        Update: {
          admin_email?: string | null;
          target_email?: string | null;
          user_agent?: string | null;
        };
      };
      generation_failure_captures: {
        Row: {
          lecture_id: string;
          user_id: string | null;
          source_type: string | null;
          language_hint: string | null;
          error_message: string | null;
          source_text: string | null;
          source_blocks: Json | null;
          processing_metadata: Json | null;
          source_char_count: number;
          captured_files: Json | null;
          captured_at: string;
        };
        Insert: {
          lecture_id: string;
          user_id?: string | null;
          source_type?: string | null;
          language_hint?: string | null;
          error_message?: string | null;
          source_text?: string | null;
          source_blocks?: Json | null;
          processing_metadata?: Json | null;
          source_char_count?: number;
          captured_files?: Json | null;
          captured_at?: string;
        };
        Update: {
          user_id?: string | null;
          source_type?: string | null;
          language_hint?: string | null;
          error_message?: string | null;
          source_text?: string | null;
          source_blocks?: Json | null;
          processing_metadata?: Json | null;
          source_char_count?: number;
          captured_files?: Json | null;
          captured_at?: string;
        };
      };
      lecture_note_media: {
        Row: {
          id: string;
          lecture_id: string;
          user_id: string;
          storage_path: string;
          mime_type: string;
          byte_size: number;
          original_file_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          user_id: string;
          storage_path: string;
          mime_type: string;
          byte_size: number;
          original_file_name?: string | null;
          created_at?: string;
        };
        Update: {
          lecture_id?: string;
          user_id?: string;
          storage_path?: string;
          mime_type?: string;
          byte_size?: number;
          original_file_name?: string | null;
        };
      };
      lecture_tts_chunks: {
        Row: {
          id: string;
          lecture_id: string;
          content_hash: string;
          chunk_index: number;
          text: string;
          word_start_index: number;
          word_end_index: number;
          language: string;
          voice: string;
          model: string;
          audio_storage_path: string;
          audio_mime_type: string;
          duration_ms: number;
          alignment_json: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          content_hash: string;
          chunk_index: number;
          text: string;
          word_start_index: number;
          word_end_index: number;
          language: string;
          voice: string;
          model: string;
          audio_storage_path: string;
          audio_mime_type?: string;
          duration_ms: number;
          alignment_json?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          content_hash?: string;
          chunk_index?: number;
          text?: string;
          word_start_index?: number;
          word_end_index?: number;
          language?: string;
          voice?: string;
          model?: string;
          audio_storage_path?: string;
          audio_mime_type?: string;
          duration_ms?: number;
          alignment_json?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_podcasts: {
        Row: {
          id: string;
          lecture_id: string;
          content_hash: string;
          format: string;
          length_id: string;
          language: string;
          status: string;
          title: string | null;
          turns: Json;
          model: string | null;
          error_message: string | null;
          generation_started_at: string | null;
          position_ms: number;
          duration_ms: number | null;
          finished_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          content_hash: string;
          format: string;
          length_id: string;
          language: string;
          status?: string;
          title?: string | null;
          turns?: Json;
          model?: string | null;
          error_message?: string | null;
          generation_started_at?: string | null;
          position_ms?: number;
          duration_ms?: number | null;
          finished_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          title?: string | null;
          turns?: Json;
          model?: string | null;
          error_message?: string | null;
          generation_started_at?: string | null;
          position_ms?: number;
          duration_ms?: number | null;
          finished_at?: string | null;
          updated_at?: string;
        };
      };
      lecture_podcast_segments: {
        Row: {
          id: string;
          podcast_id: string;
          segment_index: number;
          speaker: string;
          text: string;
          language: string;
          voice: string;
          model: string;
          audio_storage_path: string;
          audio_mime_type: string;
          duration_ms: number;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          podcast_id: string;
          segment_index: number;
          speaker: string;
          text: string;
          language: string;
          voice: string;
          model: string;
          audio_storage_path: string;
          audio_mime_type?: string;
          duration_ms: number;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          speaker?: string;
          text?: string;
          language?: string;
          voice?: string;
          model?: string;
          audio_storage_path?: string;
          audio_mime_type?: string;
          duration_ms?: number;
          generated_at?: string;
          updated_at?: string;
        };
      };
      tts_daily_usage: {
        Row: {
          user_id: string;
          usage_date: string;
          seconds_used: number;
          limit_seconds: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          usage_date: string;
          seconds_used?: number;
          limit_seconds: number;
          updated_at?: string;
        };
        Update: {
          seconds_used?: number;
          limit_seconds?: number;
          updated_at?: string;
        };
      };
      tts_generation_events: {
        Row: {
          id: string;
          user_id: string;
          lecture_id: string;
          content_hash: string;
          chunk_index: number;
          language: string;
          voice: string;
          model: string;
          usage_date: string;
          reserved_seconds: number;
          charged_seconds: number;
          status: "reserved" | "charged";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lecture_id: string;
          content_hash: string;
          chunk_index: number;
          language: string;
          voice: string;
          model: string;
          usage_date: string;
          reserved_seconds?: number;
          charged_seconds?: number;
          status?: "reserved" | "charged";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          content_hash?: string;
          chunk_index?: number;
          language?: string;
          voice?: string;
          model?: string;
          usage_date?: string;
          reserved_seconds?: number;
          charged_seconds?: number;
          status?: "reserved" | "charged";
          created_at?: string;
          updated_at?: string;
        };
      };
      tts_play_events: {
        Row: {
          id: string;
          user_id: string;
          lecture_id: string;
          session_id: string;
          content_hash: string;
          chunk_index: number;
          usage_date: string;
          charged_seconds: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lecture_id: string;
          session_id: string;
          content_hash: string;
          chunk_index: number;
          usage_date: string;
          charged_seconds: number;
          created_at?: string;
        };
        Update: {
          session_id?: string;
          content_hash?: string;
          chunk_index?: number;
          usage_date?: string;
          charged_seconds?: number;
          created_at?: string;
        };
      };
      chat_messages: {
        Row: {
          id: string;
          lecture_id: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          citations_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          citations_json?: Json;
          created_at?: string;
        };
        Update: {
          content?: string;
          citations_json?: Json;
        };
      };
      lecture_study_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_quiz_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_mindmap_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          map_json: Json;
          notes_hash: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          map_json?: Json;
          notes_hash?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          map_json?: Json;
          notes_hash?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_practice_test_assets: {
        Row: {
          lecture_id: string;
          status: StudyAssetStatus;
          error_message: string | null;
          model_metadata: Json;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          lecture_id: string;
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: StudyAssetStatus;
          error_message?: string | null;
          model_metadata?: Json;
          generated_at?: string;
          updated_at?: string;
        };
      };
      lecture_study_sections: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          title: string;
          source_label: string | null;
          source_start_ms: number | null;
          source_end_ms: number | null;
          source_page_start: number | null;
          source_page_end: number | null;
          unit_start_idx: number;
          unit_end_idx: number;
          card_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          title: string;
          source_label?: string | null;
          source_start_ms?: number | null;
          source_end_ms?: number | null;
          source_page_start?: number | null;
          source_page_end?: number | null;
          unit_start_idx: number;
          unit_end_idx: number;
          card_count?: number;
          created_at?: string;
        };
        Update: {
          idx?: number;
          title?: string;
          source_label?: string | null;
          source_start_ms?: number | null;
          source_end_ms?: number | null;
          source_page_start?: number | null;
          source_page_end?: number | null;
          unit_start_idx?: number;
          unit_end_idx?: number;
          card_count?: number;
        };
      };
      flashcards: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          front: string;
          back: string;
          hint: string | null;
          citations_json: Json;
          difficulty: FlashcardDifficulty;
          section_id: string | null;
          source_unit_idx: number;
          card_kind: string;
          concept_key: string;
          source_type: string;
          source_locator: string | null;
          coverage_rank: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          front: string;
          back: string;
          hint?: string | null;
          citations_json?: Json;
          difficulty: FlashcardDifficulty;
          section_id?: string | null;
          source_unit_idx?: number;
          card_kind?: string;
          concept_key?: string;
          source_type?: string;
          source_locator?: string | null;
          coverage_rank?: number;
          created_at?: string;
        };
        Update: {
          idx?: number;
          front?: string;
          back?: string;
          hint?: string | null;
          citations_json?: Json;
          difficulty?: FlashcardDifficulty;
          section_id?: string | null;
          source_unit_idx?: number;
          card_kind?: string;
          concept_key?: string;
          source_type?: string;
          source_locator?: string | null;
          coverage_rank?: number;
        };
      };
      flashcard_progress: {
        Row: {
          user_id: string;
          flashcard_id: string;
          confidence_bucket: FlashcardConfidenceBucket;
          review_count: number;
          last_reviewed_at: string | null;
        };
        Insert: {
          user_id: string;
          flashcard_id: string;
          confidence_bucket?: FlashcardConfidenceBucket;
          review_count?: number;
          last_reviewed_at?: string | null;
        };
        Update: {
          confidence_bucket?: FlashcardConfidenceBucket;
          review_count?: number;
          last_reviewed_at?: string | null;
        };
      };
      lecture_study_sessions: {
        Row: {
          user_id: string;
          lecture_id: string;
          active_study_view: "flashcards" | "quiz" | "practice_test";
          flashcard_state: Json | null;
          quiz_state: Json | null;
          practice_test_state: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          lecture_id: string;
          active_study_view?: "flashcards" | "quiz" | "practice_test";
          flashcard_state?: Json | null;
          quiz_state?: Json | null;
          practice_test_state?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          active_study_view?: "flashcards" | "quiz" | "practice_test";
          flashcard_state?: Json | null;
          quiz_state?: Json | null;
          practice_test_state?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      quiz_questions: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          options_json: Json;
          correct_option_idx: number;
          explanation: string;
          difficulty: FlashcardDifficulty;
          source_locator: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          options_json?: Json;
          correct_option_idx: number;
          explanation: string;
          difficulty: FlashcardDifficulty;
          source_locator?: string | null;
          created_at?: string;
        };
        Update: {
          idx?: number;
          prompt?: string;
          options_json?: Json;
          correct_option_idx?: number;
          explanation?: string;
          difficulty?: FlashcardDifficulty;
          source_locator?: string | null;
        };
      };
      practice_test_questions: {
        Row: {
          id: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          answer_guide: string;
          difficulty: FlashcardDifficulty;
          source_locator: string | null;
          source_unit_idx: number | null;
          concept_key: string | null;
          importance: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          idx: number;
          prompt: string;
          answer_guide: string;
          difficulty: FlashcardDifficulty;
          source_locator?: string | null;
          source_unit_idx?: number | null;
          concept_key?: string | null;
          importance?: number | null;
          created_at?: string;
        };
        Update: {
          idx?: number;
          prompt?: string;
          answer_guide?: string;
          difficulty?: FlashcardDifficulty;
          source_locator?: string | null;
          source_unit_idx?: number | null;
          concept_key?: string | null;
          importance?: number | null;
        };
      };
      practice_test_attempts: {
        Row: {
          id: string;
          lecture_id: string;
          user_id: string;
          status: "in_progress" | "submitted" | "graded" | "failed";
          question_count: number;
          total_score: number | null;
          max_score: number | null;
          percentage: number | null;
          graded_at: string | null;
          model_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          user_id: string;
          status?: "in_progress" | "submitted" | "graded" | "failed";
          question_count: number;
          total_score?: number | null;
          max_score?: number | null;
          percentage?: number | null;
          graded_at?: string | null;
          model_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "in_progress" | "submitted" | "graded" | "failed";
          question_count?: number;
          total_score?: number | null;
          max_score?: number | null;
          percentage?: number | null;
          graded_at?: string | null;
          model_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      practice_test_attempt_answers: {
        Row: {
          id: string;
          attempt_id: string;
          practice_test_question_id: string | null;
          idx: number;
          question_prompt: string | null;
          answer_guide_snapshot: string | null;
          difficulty_snapshot: string | null;
          source_locator_snapshot: string | null;
          typed_answer: string | null;
          photo_path: string | null;
          photo_mime_type: string | null;
          declared_unknown: boolean;
          score: number | null;
          grading_rationale: string | null;
          strengths: string | null;
          missing_points: string | null;
          expected_answer: string | null;
          grading_confidence: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          practice_test_question_id?: string | null;
          idx: number;
          question_prompt?: string | null;
          answer_guide_snapshot?: string | null;
          difficulty_snapshot?: string | null;
          source_locator_snapshot?: string | null;
          typed_answer?: string | null;
          photo_path?: string | null;
          photo_mime_type?: string | null;
          declared_unknown?: boolean;
          score?: number | null;
          grading_rationale?: string | null;
          strengths?: string | null;
          missing_points?: string | null;
          expected_answer?: string | null;
          grading_confidence?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          practice_test_question_id?: string | null;
          question_prompt?: string | null;
          answer_guide_snapshot?: string | null;
          difficulty_snapshot?: string | null;
          source_locator_snapshot?: string | null;
          typed_answer?: string | null;
          photo_path?: string | null;
          photo_mime_type?: string | null;
          declared_unknown?: boolean;
          score?: number | null;
          grading_rationale?: string | null;
          strengths?: string | null;
          missing_points?: string | null;
          expected_answer?: string | null;
          grading_confidence?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      admin_users: {
        Row: {
          id: string;
          email: string;
          role: AdminRole;
          label: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          last_seen_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          role?: AdminRole;
          label?: string | null;
          created_by?: string | null;
          last_seen_at?: string | null;
        };
        Update: {
          email?: string;
          role?: AdminRole;
          label?: string | null;
          last_seen_at?: string | null;
        };
      };
      ugc_creators: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: UgcStatus;
          kind: UgcCreatorKind;
          contact_email: string | null;
          notes: string | null;
          promo_codes: string[];
          rate_amount: number | null;
          rate_currency: string;
          rate_kind: UgcRateKind | null;
          revenue_share_percent: number | null;
          started_at: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: UgcStatus;
          kind?: UgcCreatorKind;
          contact_email?: string | null;
          notes?: string | null;
          promo_codes?: string[];
          rate_amount?: number | null;
          rate_currency?: string;
          rate_kind?: UgcRateKind | null;
          revenue_share_percent?: number | null;
          started_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          slug?: string;
          status?: UgcStatus;
          kind?: UgcCreatorKind;
          contact_email?: string | null;
          notes?: string | null;
          promo_codes?: string[];
          rate_amount?: number | null;
          rate_currency?: string;
          rate_kind?: UgcRateKind | null;
          revenue_share_percent?: number | null;
          started_at?: string | null;
        };
      };
      ugc_creator_accounts: {
        Row: {
          id: string;
          creator_id: string;
          platform: UgcPlatform;
          handle: string;
          profile_url: string;
          content_mode: UgcContentMode;
          status: UgcStatus;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          platform_account_id: string | null;
          sec_uid: string | null;
          follower_count: number | null;
          following_count: number | null;
          total_likes: number | null;
          video_count: number | null;
          last_synced_at: string | null;
          last_sync_status: "ok" | "error" | "pending" | null;
          last_sync_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          platform?: UgcPlatform;
          handle: string;
          profile_url: string;
          content_mode?: UgcContentMode;
          status?: UgcStatus;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          platform_account_id?: string | null;
          sec_uid?: string | null;
          follower_count?: number | null;
          following_count?: number | null;
          total_likes?: number | null;
          video_count?: number | null;
          last_synced_at?: string | null;
          last_sync_status?: "ok" | "error" | "pending" | null;
          last_sync_error?: string | null;
        };
        Update: {
          creator_id?: string;
          platform?: UgcPlatform;
          handle?: string;
          profile_url?: string;
          content_mode?: UgcContentMode;
          status?: UgcStatus;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          platform_account_id?: string | null;
          sec_uid?: string | null;
          follower_count?: number | null;
          following_count?: number | null;
          total_likes?: number | null;
          video_count?: number | null;
          last_synced_at?: string | null;
          last_sync_status?: "ok" | "error" | "pending" | null;
          last_sync_error?: string | null;
        };
      };
      ugc_videos: {
        Row: {
          id: string;
          account_id: string;
          creator_id: string;
          platform: UgcPlatform;
          platform_video_id: string;
          url: string;
          caption: string | null;
          hashtags: string[];
          mentions: string[];
          cover_url: string | null;
          duration_seconds: number | null;
          posted_at: string | null;
          views: number;
          likes: number;
          comments: number;
          shares: number;
          saves: number;
          classification: UgcClassification;
          classification_source: UgcClassificationSource;
          classification_confidence: number | null;
          classification_reason: string | null;
          classified_at: string | null;
          classification_locked: boolean;
          first_seen_at: string;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          creator_id: string;
          platform?: UgcPlatform;
          platform_video_id: string;
          url: string;
          caption?: string | null;
          hashtags?: string[];
          mentions?: string[];
          cover_url?: string | null;
          duration_seconds?: number | null;
          posted_at?: string | null;
          views?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          saves?: number;
          classification?: UgcClassification;
          classification_source?: UgcClassificationSource;
          classification_confidence?: number | null;
          classification_reason?: string | null;
          classified_at?: string | null;
          classification_locked?: boolean;
          last_synced_at?: string | null;
        };
        Update: {
          caption?: string | null;
          hashtags?: string[];
          mentions?: string[];
          cover_url?: string | null;
          duration_seconds?: number | null;
          posted_at?: string | null;
          views?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          saves?: number;
          classification?: UgcClassification;
          classification_source?: UgcClassificationSource;
          classification_confidence?: number | null;
          classification_reason?: string | null;
          classified_at?: string | null;
          classification_locked?: boolean;
          last_synced_at?: string | null;
        };
      };
      ugc_video_stats: {
        Row: {
          id: string;
          video_id: string;
          account_id: string;
          creator_id: string;
          captured_on: string;
          views: number;
          likes: number;
          comments: number;
          shares: number;
          saves: number;
          captured_at: string;
        };
        Insert: {
          id?: string;
          video_id: string;
          account_id: string;
          creator_id: string;
          captured_on: string;
          views?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          saves?: number;
          captured_at?: string;
        };
        Update: {
          views?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          saves?: number;
          captured_at?: string;
        };
      };
      ugc_account_stats: {
        Row: {
          id: string;
          account_id: string;
          creator_id: string;
          captured_on: string;
          follower_count: number | null;
          total_likes: number | null;
          video_count: number | null;
          captured_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          creator_id: string;
          captured_on: string;
          follower_count?: number | null;
          total_likes?: number | null;
          video_count?: number | null;
          captured_at?: string;
        };
        Update: {
          follower_count?: number | null;
          total_likes?: number | null;
          video_count?: number | null;
          captured_at?: string;
        };
      };
      ugc_classification_rules: {
        Row: {
          id: string;
          kind: UgcRuleKind;
          pattern: string;
          weight: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kind: UgcRuleKind;
          pattern: string;
          weight?: number;
          active?: boolean;
        };
        Update: {
          kind?: UgcRuleKind;
          pattern?: string;
          weight?: number;
          active?: boolean;
        };
      };
      ugc_sync_runs: {
        Row: {
          id: string;
          source: "apify" | "manual" | "push" | "profile";
          trigger: "manual" | "cron" | "push";
          status: "running" | "ok" | "partial" | "error";
          accounts_total: number;
          accounts_synced: number;
          videos_seen: number;
          videos_created: number;
          videos_updated: number;
          error: string | null;
          detail: Json | null;
          started_at: string;
          finished_at: string | null;
          started_by: string | null;
        };
        Insert: {
          id?: string;
          source: "apify" | "manual" | "push" | "profile";
          trigger?: "manual" | "cron" | "push";
          status?: "running" | "ok" | "partial" | "error";
          accounts_total?: number;
          accounts_synced?: number;
          videos_seen?: number;
          videos_created?: number;
          videos_updated?: number;
          error?: string | null;
          detail?: Json | null;
          finished_at?: string | null;
          started_by?: string | null;
        };
        Update: {
          status?: "running" | "ok" | "partial" | "error";
          accounts_total?: number;
          accounts_synced?: number;
          videos_seen?: number;
          videos_created?: number;
          videos_updated?: number;
          error?: string | null;
          detail?: Json | null;
          finished_at?: string | null;
        };
      };
      site_sessions: {
        Row: {
          id: string;
          session_key: string;
          user_id: string | null;
          first_seen_at: string;
          last_seen_at: string;
          page_views: number;
          entry_path: string | null;
          last_path: string | null;
          referrer_host: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          country: string | null;
          region: string | null;
          city: string | null;
          device_type: SiteDeviceType | null;
          browser: string | null;
          os: string | null;
          is_bot: boolean;
        };
        Insert: {
          id?: string;
          session_key: string;
          user_id?: string | null;
          page_views?: number;
          entry_path?: string | null;
          last_path?: string | null;
          referrer_host?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          country?: string | null;
          region?: string | null;
          city?: string | null;
          device_type?: SiteDeviceType | null;
          browser?: string | null;
          os?: string | null;
          is_bot?: boolean;
        };
        Update: {
          user_id?: string | null;
          last_seen_at?: string;
          page_views?: number;
          last_path?: string | null;
        };
      };
      site_page_views: {
        Row: {
          id: string;
          session_id: string;
          user_id: string | null;
          path: string;
          referrer_host: string | null;
          country: string | null;
          device_type: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id?: string | null;
          path: string;
          referrer_host?: string | null;
          country?: string | null;
          device_type?: string | null;
          created_at?: string;
        };
        Update: {
          path?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      request_account_deletion: { Args: { target_user_id: string }; Returns: undefined };
      record_site_visit: {
        Args: {
          p_session_key: string;
          p_user_id: string | null;
          p_path: string;
          p_referrer_host: string | null;
          p_utm_source: string | null;
          p_utm_medium: string | null;
          p_utm_campaign: string | null;
          p_country: string | null;
          p_region: string | null;
          p_city: string | null;
          p_device_type: string | null;
          p_browser: string | null;
          p_os: string | null;
          p_is_bot: boolean;
          p_count_page_view: boolean;
        };
        Returns: string;
      };
      admin_onboarding_breakdown: {
        Args: {
          p_from: string;
          p_to: string;
        };
        Returns: {
          question: string;
          answer: string;
          respondents: number;
        }[];
      };
      admin_onboarding_grades: {
        Args: {
          p_from: string;
          p_to: string;
        };
        Returns: {
          grade_scale: number;
          respondents: number;
          average_current: number | string;
          average_target: number | string;
          aiming_higher: number;
        }[];
      };
      site_traffic_daily: {
        Args: {
          p_from: string;
          p_to: string;
        };
        Returns: {
          day: string;
          visitors: number;
          page_views: number;
          signed_in_visitors: number;
          new_visitors: number;
        }[];
      };
      site_traffic_breakdown: {
        Args: {
          p_from: string;
          p_to: string;
          p_limit?: number;
        };
        Returns: {
          dimension: string;
          value: string;
          hits: number;
        }[];
      };
      prune_site_analytics: {
        Args: {
          p_days?: number;
        };
        Returns: number;
      };
      ugc_daily_view_deltas: {
        Args: {
          p_from: string;
          p_to: string;
          p_only_memo?: boolean;
        };
        Returns: {
          day: string;
          creator_id: string;
          views: number;
          likes: number;
          comments: number;
          shares: number;
          videos_posted: number;
        }[];
      };
      match_transcript_segments: {
        Args: {
          filter_lecture_id: string;
          match_count: number;
          query_embedding: string;
        };
        Returns: {
          id: string;
          lecture_id: string;
          idx: number;
          start_ms: number;
          end_ms: number;
          speaker_label: string | null;
          text: string;
          similarity: number;
        }[];
      };
      consume_tts_daily_quota: {
        Args: {
          p_user_id: string;
          p_lecture_id: string;
          p_session_id: string;
          p_content_hash: string;
          p_chunk_index: number;
          p_usage_date: string;
          p_seconds: number;
          p_limit_seconds: number;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type AiUsageEventRow =
  Database["public"]["Tables"]["ai_usage_events"]["Row"];
export type BillingSubscriptionRow =
  Database["public"]["Tables"]["billing_subscriptions"]["Row"];
export type LectureRow = Database["public"]["Tables"]["lectures"]["Row"];
export type LibraryFolderRow =
  Database["public"]["Tables"]["library_folders"]["Row"];
export type LibraryFolderLectureRow =
  Database["public"]["Tables"]["library_folder_lectures"]["Row"];
export type TranscriptSegmentRow =
  Database["public"]["Tables"]["transcript_segments"]["Row"];
export type LectureArtifactRow =
  Database["public"]["Tables"]["lecture_artifacts"]["Row"];
export type LectureNoteMediaRow =
  Database["public"]["Tables"]["lecture_note_media"]["Row"];
export type LectureTtsChunkRow =
  Database["public"]["Tables"]["lecture_tts_chunks"]["Row"];
export type LecturePodcastRow =
  Database["public"]["Tables"]["lecture_podcasts"]["Row"];
export type LecturePodcastSegmentRow =
  Database["public"]["Tables"]["lecture_podcast_segments"]["Row"];
export type TtsDailyUsageRow =
  Database["public"]["Tables"]["tts_daily_usage"]["Row"];
export type TtsGenerationEventRow =
  Database["public"]["Tables"]["tts_generation_events"]["Row"];
export type TtsPlayEventRow =
  Database["public"]["Tables"]["tts_play_events"]["Row"];
export type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
export type LectureStudyAssetRow =
  Database["public"]["Tables"]["lecture_study_assets"]["Row"];
export type LectureQuizAssetRow =
  Database["public"]["Tables"]["lecture_quiz_assets"]["Row"];
export type LectureMindmapAssetRow =
  Database["public"]["Tables"]["lecture_mindmap_assets"]["Row"];
export type LecturePracticeTestAssetRow =
  Database["public"]["Tables"]["lecture_practice_test_assets"]["Row"];
export type LectureStudySectionRow =
  Database["public"]["Tables"]["lecture_study_sections"]["Row"];
export type FlashcardRow = Database["public"]["Tables"]["flashcards"]["Row"];
export type FlashcardProgressRow =
  Database["public"]["Tables"]["flashcard_progress"]["Row"];
export type LectureStudySessionRow =
  Database["public"]["Tables"]["lecture_study_sessions"]["Row"];
export type QuizQuestionRow = Database["public"]["Tables"]["quiz_questions"]["Row"];
export type PracticeTestQuestionRow =
  Database["public"]["Tables"]["practice_test_questions"]["Row"];
export type PracticeTestAttemptRow =
  Database["public"]["Tables"]["practice_test_attempts"]["Row"];
export type PracticeTestAttemptAnswerRow =
  Database["public"]["Tables"]["practice_test_attempt_answers"]["Row"];

export type AdminUserRow = Database["public"]["Tables"]["admin_users"]["Row"];
export type UgcCreatorRow = Database["public"]["Tables"]["ugc_creators"]["Row"];
export type UgcCreatorAccountRow =
  Database["public"]["Tables"]["ugc_creator_accounts"]["Row"];
export type UgcVideoRow = Database["public"]["Tables"]["ugc_videos"]["Row"];
export type UgcVideoStatRow =
  Database["public"]["Tables"]["ugc_video_stats"]["Row"];
export type UgcAccountStatRow =
  Database["public"]["Tables"]["ugc_account_stats"]["Row"];
export type UgcClassificationRuleRow =
  Database["public"]["Tables"]["ugc_classification_rules"]["Row"];
export type UgcSyncRunRow = Database["public"]["Tables"]["ugc_sync_runs"]["Row"];
export type SiteSessionRow = Database["public"]["Tables"]["site_sessions"]["Row"];
export type SitePageViewRow =
  Database["public"]["Tables"]["site_page_views"]["Row"];
