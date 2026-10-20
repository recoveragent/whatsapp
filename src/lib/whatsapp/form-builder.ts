/**
 * In-app WhatsApp Form designer → Meta Flow JSON.
 *
 * A form is a list of screens; each screen holds questions and a button.
 * Every screen but the last navigates to the next one; the last screen is
 * terminal and its Footer `complete` action carries every answer, keyed by
 * the field's `name`. That payload is what arrives as `nfm_reply`
 * `response_json`, so a field named `full_name` lands in
 * `{{vars.<var_key>.full_name}}` on the Send WhatsApp Form node.
 *
 * Pure module — safe to import from client components (the designer
 * validates live) and from API routes (which re-validate before upload).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson
 *       https://developers.facebook.com/docs/whatsapp/flows/reference/components
 */

/** Newest Flow JSON version Meta recommends for publishing (changelog, Sep 2025). */
export const FLOW_JSON_VERSION = '7.3'

export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'date',
  'radio',
  'checkbox',
  'dropdown',
  'optin',
] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Short text',
  email: 'Email',
  phone: 'Phone number',
  number: 'Number',
  textarea: 'Long text',
  date: 'Date',
  radio: 'Single choice (radio)',
  checkbox: 'Multiple choice (checkboxes)',
  dropdown: 'Dropdown',
  optin: 'Consent checkbox (opt-in)',
}

/** Meta's WhatsApp Flow categories (POST /{waba_id}/flows `categories`). */
export const FLOW_CATEGORIES = [
  'LEAD_GENERATION',
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
] as const
export type FlowCategory = (typeof FLOW_CATEGORIES)[number]

export interface FormOption {
  /** Value sent back on submit. */
  id: string
  title: string
}

export interface FormField {
  type: FormFieldType
  /** Submission key — `{{vars.<var_key>.<name>}}`. */
  name: string
  label: string
  required: boolean
  helper_text?: string
  /** radio / checkbox / dropdown only. */
  options?: FormOption[]
}

export interface FormScreen {
  title: string
  /** Optional TextHeading / TextBody shown above the questions. */
  heading?: string
  body?: string
  /** Footer button — "Continue" / "Submit". */
  button_label: string
  fields: FormField[]
}

export interface FormDefinition {
  screens: FormScreen[]
}

/** Component limits from Meta's components reference. */
export const FORM_LIMITS = {
  screens: 10,
  /** Per screen, including heading/body/footer. */
  componentsPerScreen: 50,
  optInsPerScreen: 5,
  footerLabel: 35,
  heading: 80,
  body: 4096,
  helperText: 80,
  name: 40,
  optionTitle: 30,
  choiceOptions: 20,
  dropdownOptions: 200,
  label: {
    text: 20,
    email: 20,
    phone: 20,
    number: 20,
    textarea: 20,
    date: 40,
    radio: 30,
    checkbox: 30,
    dropdown: 20,
    optin: 120,
  } satisfies Record<FormFieldType, number>,
} as const

const NAME_RE = /^[a-z][a-z0-9_]*$/

export const hasOptions = (t: FormFieldType): boolean =>
  t === 'radio' || t === 'checkbox' || t === 'dropdown'

/** `Full name!` → `full_name` — a valid submission key. */
export function toFieldName(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, FORM_LIMITS.name)
  if (!slug) return 'field'
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`.slice(0, FORM_LIMITS.name)
}

/** Screen IDs: Meta allows letters and underscores only. */
export function screenId(index: number): string {
  let n = index
  let suffix = ''
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `STEP_${suffix}`
}

export interface FormIssue {
  /** Screen index, field index (when the issue is on a field). */
  screen: number
  field?: number
  message: string
}

/** Everything that would make Meta reject the Flow JSON, in UI-friendly form. */
export function validateFormDefinition(def: FormDefinition): FormIssue[] {
  const issues: FormIssue[] = []
  const screens = Array.isArray(def?.screens) ? def.screens : []
  if (screens.length === 0) {
    issues.push({ screen: 0, message: 'Add at least one screen.' })
    return issues
  }
  if (screens.length > FORM_LIMITS.screens) {
    issues.push({ screen: 0, message: `A form can have at most ${FORM_LIMITS.screens} screens.` })
  }

  const seenNames = new Map<string, number>()
  let total = 0
  screens.forEach((s, si) => {
    const fields = Array.isArray(s.fields) ? s.fields : []
    total += fields.length
    if (!s.title?.trim()) issues.push({ screen: si, message: 'Screen title is required.' })
    if (!s.button_label?.trim()) {
      issues.push({ screen: si, message: 'Button label is required.' })
    } else if (s.button_label.trim().length > FORM_LIMITS.footerLabel) {
      issues.push({ screen: si, message: `Button label must be ${FORM_LIMITS.footerLabel} characters or fewer.` })
    }
    if (s.heading && s.heading.trim().length > FORM_LIMITS.heading) {
      issues.push({ screen: si, message: `Heading must be ${FORM_LIMITS.heading} characters or fewer.` })
    }
    if (s.body && s.body.length > FORM_LIMITS.body) {
      issues.push({ screen: si, message: `Description must be ${FORM_LIMITS.body} characters or fewer.` })
    }
    const components = fields.length + 1 + (s.heading?.trim() ? 1 : 0) + (s.body?.trim() ? 1 : 0)
    if (components > FORM_LIMITS.componentsPerScreen) {
      issues.push({ screen: si, message: `A screen can hold at most ${FORM_LIMITS.componentsPerScreen} components — move some questions to another screen.` })
    }
    if (fields.filter((f) => f.type === 'optin').length > FORM_LIMITS.optInsPerScreen) {
      issues.push({ screen: si, message: `At most ${FORM_LIMITS.optInsPerScreen} consent checkboxes per screen.` })
    }

    fields.forEach((f, fi) => {
      const at = (message: string) => issues.push({ screen: si, field: fi, message })
      if (!FORM_FIELD_TYPES.includes(f.type)) {
        at('Unknown question type.')
        return
      }
      const label = f.label?.trim() ?? ''
      const max = FORM_LIMITS.label[f.type]
      if (!label) at('Question label is required.')
      else if (label.length > max) at(`Label must be ${max} characters or fewer for this question type.`)

      if (!NAME_RE.test(f.name ?? '')) {
        at('Field key must start with a letter and use only lowercase letters, numbers and _.')
      } else if (f.name.length > FORM_LIMITS.name) {
        at(`Field key must be ${FORM_LIMITS.name} characters or fewer.`)
      } else if (seenNames.has(f.name)) {
        at(`Field key "${f.name}" is already used — each answer needs its own key.`)
      } else {
        seenNames.set(f.name, si)
      }

      if (f.helper_text && f.helper_text.length > FORM_LIMITS.helperText) {
        at(`Helper text must be ${FORM_LIMITS.helperText} characters or fewer.`)
      }

      if (hasOptions(f.type)) {
        const opts = f.options ?? []
        const maxOpts = f.type === 'dropdown' ? FORM_LIMITS.dropdownOptions : FORM_LIMITS.choiceOptions
        if (opts.length === 0) at('Add at least one option.')
        if (opts.length > maxOpts) at(`At most ${maxOpts} options.`)
        const ids = new Set<string>()
        for (const o of opts) {
          const title = o.title?.trim() ?? ''
          if (!title) at('Option text cannot be empty.')
          else if (title.length > FORM_LIMITS.optionTitle) at(`Option "${title.slice(0, 20)}…" must be ${FORM_LIMITS.optionTitle} characters or fewer.`)
          if (!o.id?.trim()) at('Option value cannot be empty.')
          else if (ids.has(o.id)) at(`Option value "${o.id}" is repeated.`)
          ids.add(o.id)
        }
      }
    })
  })
  if (total === 0) issues.push({ screen: 0, message: 'Add at least one question.' })
  return issues
}

type Json = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Coerce untrusted input (API bodies, stored jsonb) into the definition
 * shape, dropping unknown keys. Doesn't validate — pair with
 * `validateFormDefinition`.
 */
export function sanitizeFormDefinition(raw: unknown): FormDefinition {
  const screens = isObj(raw) && Array.isArray(raw.screens) ? raw.screens : []
  return {
    screens: screens.filter(isObj).map((s) => ({
      title: str(s.title),
      ...(str(s.heading) ? { heading: str(s.heading) } : {}),
      ...(str(s.body) ? { body: str(s.body) } : {}),
      button_label: str(s.button_label),
      fields: (Array.isArray(s.fields) ? s.fields : []).filter(isObj).map((f) => {
        const type = (FORM_FIELD_TYPES as readonly string[]).includes(str(f.type))
          ? (f.type as FormFieldType)
          : 'text'
        return {
          type,
          name: str(f.name),
          label: str(f.label),
          required: f.required === true,
          ...(str(f.helper_text) ? { helper_text: str(f.helper_text) } : {}),
          ...(hasOptions(type)
            ? {
                options: (Array.isArray(f.options) ? f.options : [])
                  .filter(isObj)
                  .map((o) => ({ id: str(o.id), title: str(o.title) })),
              }
            : {}),
        }
      }),
    })),
  }
}

function fieldComponent(f: FormField): Json {
  const base: Json = { name: f.name, label: f.label.trim(), required: !!f.required }
  const helper = f.helper_text?.trim() ? { 'helper-text': f.helper_text.trim() } : {}
  const dataSource = (f.options ?? []).map((o) => ({ id: o.id.trim(), title: o.title.trim() }))
  switch (f.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'number':
      return { type: 'TextInput', ...base, 'input-type': f.type, ...helper }
    case 'textarea':
      return { type: 'TextArea', ...base, ...helper }
    case 'date':
      return { type: 'DatePicker', ...base, ...helper }
    case 'radio':
      return { type: 'RadioButtonsGroup', ...base, 'data-source': dataSource }
    case 'checkbox':
      return { type: 'CheckboxGroup', ...base, 'data-source': dataSource }
    case 'dropdown':
      return { type: 'Dropdown', ...base, 'data-source': dataSource }
    case 'optin':
      return { type: 'OptIn', ...base }
  }
}

/**
 * Build Flow JSON for a valid definition (call `validateFormDefinition`
 * first — this throws on the first issue so bad JSON never reaches Meta).
 *
 * Answers from earlier screens are read with global references
 * (`${screen.STEP_A.form.x}`, Flow JSON 4.0+) so the final `complete`
 * payload carries every field without threading navigate payloads.
 */
export function buildFlowJson(def: FormDefinition): Json {
  const issues = validateFormDefinition(def)
  if (issues.length > 0) throw new Error(issues[0]!.message)

  const last = def.screens.length - 1
  const payload: Record<string, string> = {}
  def.screens.forEach((s, si) => {
    for (const f of s.fields) {
      payload[f.name] = si === last ? `\${form.${f.name}}` : `\${screen.${screenId(si)}.form.${f.name}}`
    }
  })

  const screens = def.screens.map((s, si) => {
    const children: Json[] = []
    if (s.heading?.trim()) children.push({ type: 'TextHeading', text: s.heading.trim() })
    if (s.body?.trim()) children.push({ type: 'TextBody', text: s.body.trim() })
    children.push(...s.fields.map(fieldComponent))
    children.push({
      type: 'Footer',
      label: s.button_label.trim(),
      'on-click-action':
        si === last
          ? { name: 'complete', payload }
          : { name: 'navigate', next: { type: 'screen', name: screenId(si + 1) }, payload: {} },
    })
    return {
      id: screenId(si),
      title: s.title.trim(),
      ...(si === last ? { terminal: true, success: true } : {}),
      layout: { type: 'SingleColumnLayout', children },
    }
  })

  return { version: FLOW_JSON_VERSION, screens }
}

/** Starter form for "New form": name, date, radio and checkbox questions. */
export function defaultFormDefinition(): FormDefinition {
  return {
    screens: [
      {
        title: 'Your details',
        heading: 'Tell us a bit about you',
        button_label: 'Submit',
        fields: [
          { type: 'text', name: 'full_name', label: 'Full name', required: true },
          { type: 'date', name: 'preferred_date', label: 'Preferred date', required: false },
          {
            type: 'radio',
            name: 'contact_method',
            label: 'How should we contact you?',
            required: true,
            options: [
              { id: 'whatsapp', title: 'WhatsApp' },
              { id: 'call', title: 'Phone call' },
            ],
          },
          {
            type: 'checkbox',
            name: 'interests',
            label: 'What are you interested in?',
            required: false,
            options: [
              { id: 'pricing', title: 'Pricing' },
              { id: 'demo', title: 'Product demo' },
            ],
          },
        ],
      },
    ],
  }
}
