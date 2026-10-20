/**
 * Read the parts of a WhatsApp Flow JSON the builder needs: which screen
 * opens first and which keys a submission will carry.
 *
 * Submission keys come from the `payload` of the terminal `complete`
 * action — that payload becomes `nfm_reply.response_json`. Component
 * `name`s are only a fallback for Flows whose payload we can't read.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson
 */

export interface FlowFormField {
  /** Key under `{{vars.<var_key>.<key>}}` after submission. */
  key: string
  /** Label shown to the customer, when we could resolve it. */
  label?: string
  /**
   * Choices for radio / checkbox / dropdown fields. A submission carries
   * the chosen `id`, so conditions compare against ids.
   */
  options?: Array<{ id: string; title: string }>
}

export interface FlowJsonSummary {
  /** Screen opened by the CTA — first screen nothing navigates to. */
  entry_screen: string | null
  screen_ids: string[]
  fields: FlowFormField[]
}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Depth-first walk over every object in the layout tree. */
function walk(node: unknown, visit: (o: Json) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit)
    return
  }
  if (!isObj(node)) return
  visit(node)
  for (const v of Object.values(node)) walk(v, visit)
}

export function summarizeFlowJson(raw: unknown): FlowJsonSummary {
  const screens = isObj(raw) && Array.isArray(raw.screens) ? raw.screens : []
  const screenIds = screens
    .map((s) => (isObj(s) && typeof s.id === 'string' ? s.id : ''))
    .filter(Boolean)

  const navigatedTo = new Set<string>()
  const labels = new Map<string, string>()
  const options = new Map<string, Array<{ id: string; title: string }>>()
  const inputNames: string[] = []
  const payloadKeys: string[] = []
  const payloadSource = new Map<string, string>()

  walk(screens, (o) => {
    if (typeof o.name === 'string' && typeof o.type === 'string' && o.type !== 'Form') {
      if (!inputNames.includes(o.name)) inputNames.push(o.name)
      if (typeof o.label === 'string') labels.set(o.name, o.label)
      const source = o['data-source']
      if (Array.isArray(source)) {
        const opts = source
          .filter(isObj)
          .filter((d) => typeof d.id === 'string' && d.id)
          .map((d) => ({ id: d.id as string, title: typeof d.title === 'string' ? d.title : (d.id as string) }))
        if (opts.length > 0) options.set(o.name, opts)
      }
    }
    const action = o['on-click-action']
    if (!isObj(action)) return
    if (action.name === 'navigate' && isObj(action.next) && typeof action.next.name === 'string') {
      navigatedTo.add(action.next.name)
    }
    if (action.name === 'complete' && isObj(action.payload)) {
      for (const [k, v] of Object.entries(action.payload)) {
        if (!payloadKeys.includes(k)) payloadKeys.push(k)
        // `${form.full_name}` / `${data.x}` / `${screen.STEP_A.form.x}` → component name
        const m = typeof v === 'string' ? /^\$\{(?:screen\.[\w-]+\.)?(?:form|data)\.([\w-]+)\}$/.exec(v) : null
        if (m) payloadSource.set(k, m[1]!)
      }
    }
  })

  const keys = payloadKeys.length > 0 ? payloadKeys : inputNames
  return {
    entry_screen: screenIds.find((id) => !navigatedTo.has(id)) ?? screenIds[0] ?? null,
    screen_ids: screenIds,
    fields: keys.map((key) => {
      const source = payloadSource.get(key) ?? key
      const label = labels.get(source)
      const opts = options.get(source)
      return { key, ...(label ? { label } : {}), ...(opts ? { options: opts } : {}) }
    }),
  }
}
