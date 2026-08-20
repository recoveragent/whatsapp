export const LEAD_STATUSES = [
  'new',
  'in_cadence',
  'replied',
  'meeting_booked',
  'onboarded',
  'expired',
  'lost',
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_LANGUAGES = ['en', 'hi'] as const
export type LeadLanguage = (typeof LEAD_LANGUAGES)[number]

export const CADENCE_KINDS = ['new_lead', 'reactivation', 'custom'] as const
export type CadenceKind = (typeof CADENCE_KINDS)[number]

export const CADENCE_CHANNELS = [
  'wa_template',
  'call_task',
  'voice_note_task',
] as const
export type CadenceChannel = (typeof CADENCE_CHANNELS)[number]

export const ENROLLMENT_STATUSES = [
  'active',
  'paused',
  'completed',
  'exited',
] as const
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

export const CRM_TASK_TYPES = ['call', 'voice_note'] as const
export type CrmTaskType = (typeof CRM_TASK_TYPES)[number]

export const CRM_TASK_STATUSES = [
  'pending',
  'claimed',
  'completed',
  'cancelled',
] as const
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number]

export const CRM_TASK_OUTCOMES = [
  'no_answer',
  'busy',
  'later',
  'booked',
  'not_interested',
  'wrong_number',
  'connected',
] as const
export type CrmTaskOutcome = (typeof CRM_TASK_OUTCOMES)[number]

export const EXIT_REASONS = [
  'replied',
  'meeting_booked',
  'not_interested',
  'wrong_number',
  'expired',
  'manual',
] as const
export type ExitReason = (typeof EXIT_REASONS)[number]

export const CLAIM_MINUTES = 15

export const DEFAULT_CALL_DAYS = [1, 2, 3, 4, 5, 6] as const
export const DEFAULT_CALL_HOURS_START = '10:00'
export const DEFAULT_CALL_HOURS_END = '19:00'
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'
export const DEFAULT_EXPIRE_DAYS = 30

export interface Cadence {
  id: string
  account_id: string
  user_id: string
  name: string
  kind: CadenceKind
  timezone: string
  call_hours_start: string
  call_hours_end: string
  call_days: number[]
  expire_after_days: number
  created_at: string
  updated_at: string
  steps?: CadenceStep[]
}

export interface CadenceStep {
  id: string
  cadence_id: string
  position: number
  delay_minutes: number
  channel: CadenceChannel
  template_name: string | null
  script_en: string | null
  script_hi: string | null
  created_at: string
}

export interface LeadSource {
  id: string
  account_id: string
  user_id: string
  name: string
  cadence_id: string | null
  spreadsheet_id: string
  spreadsheet_url: string | null
  sheet_name: string
  phone_column: string
  name_column: string | null
  email_column: string | null
  language_column: string | null
  default_language: LeadLanguage
  last_processed_row: number | null
  sync_existing: boolean
  active: boolean
  created_at: string
  updated_at: string
  cadence?: { id: string; name: string; kind: CadenceKind } | null
}

export interface CadenceEnrollment {
  id: string
  account_id: string
  user_id: string
  contact_id: string
  cadence_id: string
  lead_source_id: string | null
  status: EnrollmentStatus
  current_step_position: number
  next_run_at: string | null
  claimed_until: string | null
  started_at: string
  paused_at: string | null
  completed_at: string | null
  exit_reason: string | null
  last_error: string | null
}

export interface CrmTask {
  id: string
  account_id: string
  contact_id: string
  enrollment_id: string | null
  cadence_step_id: string | null
  conversation_id: string | null
  type: CrmTaskType
  status: CrmTaskStatus
  due_at: string
  claimed_by: string | null
  claimed_until: string | null
  completed_by: string | null
  completed_at: string | null
  outcome: CrmTaskOutcome | null
  outcome_note: string | null
  script: string | null
  campaign_name: string | null
  created_at: string
}

export function isLeadLanguage(value: unknown): value is LeadLanguage {
  return value === 'en' || value === 'hi'
}

export function isCrmTaskOutcome(value: unknown): value is CrmTaskOutcome {
  return (
    typeof value === 'string' &&
    (CRM_TASK_OUTCOMES as readonly string[]).includes(value)
  )
}
