import { describe, expect, it } from 'vitest'

import {
  buildFlowJson,
  defaultFormDefinition,
  FLOW_JSON_VERSION,
  sanitizeFormDefinition,
  screenId,
  toFieldName,
  validateFormDefinition,
  type FormDefinition,
} from './form-builder'
import { summarizeFlowJson } from './flow-json'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const allTypes: FormDefinition = {
  screens: [
    {
      title: 'Contact',
      heading: 'Hi there',
      body: 'Two quick steps.',
      button_label: 'Continue',
      fields: [
        { type: 'text', name: 'full_name', label: 'Full name', required: true, helper_text: 'As on ID' },
        { type: 'email', name: 'email', label: 'Email', required: false },
        { type: 'phone', name: 'phone', label: 'Phone', required: false },
        { type: 'number', name: 'age', label: 'Age', required: false },
      ],
    },
    {
      title: 'Preferences',
      button_label: 'Submit',
      fields: [
        { type: 'textarea', name: 'notes', label: 'Notes', required: false },
        { type: 'date', name: 'visit_date', label: 'Visit date', required: true },
        { type: 'radio', name: 'size', label: 'Size', required: true, options: [{ id: 's', title: 'Small' }, { id: 'l', title: 'Large' }] },
        { type: 'checkbox', name: 'extras', label: 'Extras', required: false, options: [{ id: 'gift', title: 'Gift wrap' }] },
        { type: 'dropdown', name: 'city', label: 'City', required: false, options: [{ id: 'blr', title: 'Bengaluru' }] },
        { type: 'optin', name: 'marketing_ok', label: 'Send me offers on WhatsApp', required: false },
      ],
    },
  ],
}

describe('buildFlowJson', () => {
  it('builds a single terminal screen with a complete payload mapping each field', () => {
    const json = buildFlowJson(defaultFormDefinition()) as Json
    expect(json.version).toBe(FLOW_JSON_VERSION)
    expect(json.screens).toHaveLength(1)
    const [screen] = json.screens
    expect(screen).toMatchObject({ id: 'STEP_A', title: 'Your details', terminal: true, success: true })
    expect(screen.layout.type).toBe('SingleColumnLayout')
    const footer = screen.layout.children.at(-1)
    expect(footer).toEqual({
      type: 'Footer',
      label: 'Submit',
      'on-click-action': {
        name: 'complete',
        payload: {
          full_name: '${form.full_name}',
          preferred_date: '${form.preferred_date}',
          contact_method: '${form.contact_method}',
          interests: '${form.interests}',
        },
      },
    })
  })

  it('maps every question type to the right Meta component', () => {
    const json = buildFlowJson(allTypes) as Json
    const [a, b] = json.screens
    const comps = [...a.layout.children, ...b.layout.children].filter((c: Json) => c.name)
    expect(comps.map((c: Json) => [c.name, c.type, c['input-type']])).toEqual([
      ['full_name', 'TextInput', 'text'],
      ['email', 'TextInput', 'email'],
      ['phone', 'TextInput', 'phone'],
      ['age', 'TextInput', 'number'],
      ['notes', 'TextArea', undefined],
      ['visit_date', 'DatePicker', undefined],
      ['size', 'RadioButtonsGroup', undefined],
      ['extras', 'CheckboxGroup', undefined],
      ['city', 'Dropdown', undefined],
      ['marketing_ok', 'OptIn', undefined],
    ])
    expect(a.layout.children[0]).toEqual({ type: 'TextHeading', text: 'Hi there' })
    expect(a.layout.children[1]).toEqual({ type: 'TextBody', text: 'Two quick steps.' })
    expect(comps[0]).toMatchObject({ required: true, 'helper-text': 'As on ID', label: 'Full name' })
    expect(comps[6]['data-source']).toEqual([{ id: 's', title: 'Small' }, { id: 'l', title: 'Large' }])
  })

  it('chains screens with navigate and reads earlier answers via screen references', () => {
    const json = buildFlowJson(allTypes) as Json
    const [a, b] = json.screens
    expect(a.terminal).toBeUndefined()
    expect(a.layout.children.at(-1)['on-click-action']).toEqual({
      name: 'navigate',
      next: { type: 'screen', name: 'STEP_B' },
      payload: {},
    })
    const payload = b.layout.children.at(-1)['on-click-action'].payload
    expect(payload.full_name).toBe('${screen.STEP_A.form.full_name}')
    expect(payload.visit_date).toBe('${form.visit_date}')
    expect(Object.keys(payload)).toHaveLength(10)
  })

  it('round-trips through summarizeFlowJson so the Send WhatsApp Form picker sees the fields', () => {
    const summary = summarizeFlowJson(buildFlowJson(allTypes))
    expect(summary.entry_screen).toBe('STEP_A')
    expect(summary.screen_ids).toEqual(['STEP_A', 'STEP_B'])
    expect(summary.fields.map((f) => f.key)).toContain('marketing_ok')
    expect(summary.fields.find((f) => f.key === 'full_name')).toEqual({ key: 'full_name', label: 'Full name' })
  })

  it('refuses to build invalid definitions', () => {
    expect(() => buildFlowJson({ screens: [] })).toThrow(/at least one screen/)
  })
})

describe('validateFormDefinition', () => {
  const one = (fields: FormDefinition['screens'][number]['fields']): FormDefinition => ({
    screens: [{ title: 'T', button_label: 'Submit', fields }],
  })

  it('accepts the starter form', () => {
    expect(validateFormDefinition(defaultFormDefinition())).toEqual([])
  })

  it('flags duplicate keys across screens', () => {
    const def = structuredClone(allTypes)
    def.screens[1]!.fields[0]!.name = 'full_name'
    expect(validateFormDefinition(def)).toEqual([
      expect.objectContaining({ screen: 1, field: 0, message: expect.stringMatching(/already used/) }),
    ])
  })

  it('enforces Meta label limits per component', () => {
    const issues = validateFormDefinition(one([{ type: 'text', name: 'x', label: 'A'.repeat(21), required: false }]))
    expect(issues[0]?.message).toMatch(/20 characters/)
    expect(validateFormDefinition(one([{ type: 'date', name: 'x', label: 'A'.repeat(40), required: false }]))).toEqual([])
  })

  it('requires options for choice questions and unique option values', () => {
    expect(validateFormDefinition(one([{ type: 'radio', name: 'x', label: 'Pick', required: true, options: [] }]))[0]?.message).toMatch(/at least one option/)
    const dup = one([{ type: 'checkbox', name: 'x', label: 'Pick', required: true, options: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }])
    expect(validateFormDefinition(dup)[0]?.message).toMatch(/repeated/)
  })

  it('rejects bad keys, empty forms and too many opt-ins', () => {
    expect(validateFormDefinition(one([{ type: 'text', name: 'Full Name', label: 'Name', required: false }]))[0]?.message).toMatch(/Field key/)
    expect(validateFormDefinition(one([]))[0]?.message).toMatch(/at least one question/)
    const optins = Array.from({ length: 6 }, (_, i) => ({ type: 'optin' as const, name: `ok_${i}`, label: 'OK', required: false }))
    expect(validateFormDefinition(one(optins)).map((i) => i.message)).toContainEqual(expect.stringMatching(/consent/))
  })
})

describe('sanitizeFormDefinition', () => {
  it('drops unknown keys and coerces junk into the definition shape', () => {
    const def = sanitizeFormDefinition({
      screens: [
        { title: 'T', button_label: 'Go', evil: 1, fields: [{ type: 'radio', name: 'x', label: 'X', required: 'yes', options: [{ id: 'a', title: 'A', x: 1 }] }, 'nope'] },
        null,
      ],
    })
    expect(def).toEqual({
      screens: [{ title: 'T', button_label: 'Go', fields: [{ type: 'radio', name: 'x', label: 'X', required: false, options: [{ id: 'a', title: 'A' }] }] }],
    })
    expect(sanitizeFormDefinition('garbage')).toEqual({ screens: [] })
  })
})

describe('helpers', () => {
  it('slugifies labels into field keys', () => {
    expect(toFieldName('Full name!')).toBe('full_name')
    expect(toFieldName('2nd choice')).toBe('f_2nd_choice')
    expect(toFieldName('***')).toBe('field')
  })

  it('generates letter-only screen ids', () => {
    expect([0, 1, 25, 26].map(screenId)).toEqual(['STEP_A', 'STEP_B', 'STEP_Z', 'STEP_AA'])
  })
})
