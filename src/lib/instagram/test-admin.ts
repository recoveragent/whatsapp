import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
type Options = { now?: string; unique?: Record<string, string[][]> };

/** Test-only in-memory stand-in for the Supabase query builder. Applies every filter it is given. */
export function testAdmin(tables: Record<string, Row[]>, { now = '2026-11-24T10:00:00.000Z', unique = {} }: Options = {}) {
  const calls: Row[] = [];
  let nextId = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let action: 'select' | 'insert' | 'update' = 'select';
    let values: Row = {};
    let counting = false;
    let order: [string, boolean] | null = null;
    let limit = Infinity;
    const execute = () => {
      if (action === 'insert') {
        const clash = (unique[table] ?? []).some((keys) => rows.some((r) => keys.every((k) => r[k] === values[k])));
        if (clash) return { data: [], error: { code: '23505', message: 'duplicate' }, count: null };
        const row: Row = { id: `row${nextId++}`, created_at: now, status: 'sending', public_status: null, ...values };
        rows.push(row);
        return { data: [row], error: null, count: 1 };
      }
      let found = rows.filter((r) => filters.every((f) => f(r)));
      if (action === 'update') found.forEach((r) => Object.assign(r, values));
      const count = found.length;
      if (order) { const [key, up] = order; found = [...found].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (up ? 1 : -1)); }
      return { data: counting ? null : found.slice(0, limit).map((r) => ({ ...r })), error: null, count };
    };
    const single = () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; };
    const q = {
      select: (_columns?: string, options?: { head?: boolean }) => { counting = options?.head === true; return q; },
      insert: (v: Row) => { action = 'insert'; values = v; return q; },
      update: (v: Row) => { action = 'update'; values = v; return q; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
      gte: (k: string, v: string) => { filters.push((r) => Date.parse(r[k] as string) >= Date.parse(v)); return q; },
      is: (k: string, v: null) => { filters.push((r) => (r[k] ?? null) === v); return q; },
      not: (k: string, _op: string, v: null) => { filters.push((r) => (r[k] ?? null) !== v); return q; },
      or: (text: string) => {
        const parts = text.split(',').map((p) => p.match(/^(\w+)\.(is\.null|lt)\.?(.*)$/)!);
        filters.push((r) => parts.some(([, k, op, v]) => (op === 'is.null' ? (r[k] ?? null) === null : r[k] != null && Date.parse(r[k] as string) < Date.parse(v))));
        return q;
      },
      order: (k: string, o: { ascending: boolean }) => { order = [k, o.ascending]; return q; },
      limit: (n: number) => { limit = n; return q; },
      single: async () => single(),
      maybeSingle: async () => single(),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(execute).then(resolve, reject),
    };
    return q;
  };
  const rpc = async (_name: string, args: Row) => { calls.push(args); return { error: null }; };
  return { admin: { from, rpc } as unknown as SupabaseClient, tables, calls };
}
