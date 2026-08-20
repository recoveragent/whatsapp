import type { CadenceChannel, CadenceKind } from './types'
import {
  DEFAULT_CALL_DAYS,
  DEFAULT_CALL_HOURS_END,
  DEFAULT_CALL_HOURS_START,
  DEFAULT_EXPIRE_DAYS,
  DEFAULT_TIMEZONE,
} from './types'

const CALL_SCRIPT_EN =
  'Hi, you filled our form about the AI voice product. Can we book a 15-minute demo this week?'
const CALL_SCRIPT_HI =
  'Namaste, aapne hamare AI voice product ke form mein interest dikhaya tha. Is hafte 15 minute ka demo book karein?'

export interface CadenceStepSeed {
  position: number
  delay_minutes: number
  channel: CadenceChannel
  template_name: null
  script_en: string | null
  script_hi: string | null
}

export interface CadenceSeed {
  name: string
  kind: CadenceKind
  timezone: string
  call_hours_start: string
  call_hours_end: string
  call_days: number[]
  expire_after_days: number
  steps: CadenceStepSeed[]
}

function callScripts(): Pick<CadenceStepSeed, 'script_en' | 'script_hi'> {
  return { script_en: CALL_SCRIPT_EN, script_hi: CALL_SCRIPT_HI }
}

function waStep(position: number, delayMinutes: number): CadenceStepSeed {
  return {
    position,
    delay_minutes: delayMinutes,
    channel: 'wa_template',
    template_name: null,
    script_en: null,
    script_hi: null,
  }
}

function callStep(position: number, delayMinutes: number): CadenceStepSeed {
  return {
    position,
    delay_minutes: delayMinutes,
    channel: 'call_task',
    template_name: null,
    ...callScripts(),
  }
}

export const DEFAULT_CADENCE_SEEDS: CadenceSeed[] = [
  {
    name: 'New Instant Form',
    kind: 'new_lead',
    timezone: DEFAULT_TIMEZONE,
    call_hours_start: DEFAULT_CALL_HOURS_START,
    call_hours_end: DEFAULT_CALL_HOURS_END,
    call_days: [...DEFAULT_CALL_DAYS],
    expire_after_days: DEFAULT_EXPIRE_DAYS,
    steps: [
      waStep(1, 0),
      callStep(2, 120),
      waStep(3, 24 * 60),
      callStep(4, 3 * 24 * 60),
      waStep(5, 7 * 24 * 60),
    ],
  },
  {
    name: 'Reactivation',
    kind: 'reactivation',
    timezone: DEFAULT_TIMEZONE,
    call_hours_start: DEFAULT_CALL_HOURS_START,
    call_hours_end: DEFAULT_CALL_HOURS_END,
    call_days: [...DEFAULT_CALL_DAYS],
    expire_after_days: DEFAULT_EXPIRE_DAYS,
    steps: [waStep(1, 0), callStep(2, 120), waStep(3, 7 * 24 * 60)],
  },
]
