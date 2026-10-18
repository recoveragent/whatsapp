import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowRow, ParsedInbound } from './types';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  sends: [] as string[],
  seq: 0,
}));

vi.mock('./admin-client', () => {
  function from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let insert: Row | undefined;
    let update: Row | undefined;
    let count = false;
    let limit = Infinity;
    const b = {
      select: (_columns?: string, opts?: { count?: string }) => {
        count = !!opts?.count;
        return b;
      },
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return b;
      },
      is: (key: string, value: unknown) => b.eq(key, value),
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return b;
      },
      lte: (key: string, value: string) => {
        filters.push((row) => String(row[key]) <= value);
        return b;
      },
      filter: (key: string, _op: string, value: unknown) => {
        filters.push((row) =>
          key.startsWith('payload->>')
            ? (row.payload as Row)?.[key.slice(10)] === value
            : row[key] === value
        );
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        limit = n;
        return b;
      },
      insert: (row: Row) => {
        insert = row;
        return b;
      },
      update: (row: Row) => {
        update = row;
        return b;
      },
      maybeSingle: async () => {
        const r = result();
        return { ...r, data: r.data[0] ?? null };
      },
      single: async () => b.maybeSingle(),
      then: (resolve: (r: ReturnType<typeof result>) => unknown) =>
        resolve(result()),
    };
    function result() {
      const rows = (h.tables[table] ??= []);
      if (insert) {
        if (insert.id && rows.some((row) => row.id === insert!.id)) {
          return { data: [] as Row[], error: { code: '23505' }, count: 0 };
        }
        const row = {
          id: `row-${++h.seq}`,
          vars: {},
          reprompt_count: 0,
          last_prompt_message_id: null,
          last_advanced_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          ...insert,
        };
        rows.push(row);
        return { data: [{ ...row }], error: null, count: 1 };
      }
      const selected = rows
        .filter((row) => filters.every((f) => f(row)))
        .slice(0, limit);
      if (update) selected.forEach((row) => Object.assign(row, update));
      return {
        data: selected.map((row) => ({ ...row })),
        error: null,
        count: count ? selected.length : 0,
      };
    }
    return b;
  }
  return {
    supabaseAdmin: () => ({ from, rpc: vi.fn(async () => ({ error: null })) }),
  };
});
vi.mock('./apply-exit', () => ({
  applyFlowExitEventWithClient: vi.fn(async () => ({ endedRunIds: [] })),
}));
vi.mock('./backfill-outbound-prompt', () => ({
  ensureFlowOutboundPersisted: vi.fn(),
}));
vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async ({ text }: { text: string }) => {
    h.sends.push(text);
    return { whatsapp_message_id: `wamid.${h.sends.length}` };
  }),
}));
vi.mock('@/lib/automations/meta-send', () => ({
  engineSendTemplate: vi.fn(
    async ({ templateName }: { templateName: string }) => {
      h.sends.push(templateName);
      return { whatsapp_message_id: `wamid.${h.sends.length}` };
    }
  ),
}));
vi.mock('./resolve-product-image', () => ({
  resolveFlowProductImageUrl: vi.fn(),
}));

import {
  dispatchInboundToFlows,
  resumeFlowPendingExecutions,
  startFlowForExternalEvent,
} from './engine';

const flow = {
  id: 'flow',
  account_id: 'account',
  user_id: 'user',
  entry_node_id: 'confirmation',
  trigger_type: 'shopify_order_placed',
  trigger_config: {},
  fallback_policy: { on_unknown_reply: 'ignore' },
} as unknown as FlowRow;

function node(key: string, type: string, config: Row) {
  return {
    id: key,
    flow_id: flow.id,
    node_key: key,
    node_type: type,
    config:
      type === 'send_template' ? { template_name: key, ...config } : config,
  };
}
function timeout(next: string, minutes = 4 * 60) {
  return {
    reply_timeout_enabled: true,
    reply_timeout_amount: minutes,
    reply_timeout_unit: 'minutes',
    reply_timeout_next_node_key: next,
  };
}
async function start() {
  return startFlowForExternalEvent({
    flow,
    contactId: 'contact',
    conversationId: 'conversation',
  });
}
async function reply(message: ParsedInbound) {
  return dispatchInboundToFlows({
    accountId: 'account',
    userId: 'user',
    contactId: 'contact',
    conversationId: 'conversation',
    isFirstInboundMessage: false,
    message,
  });
}
function due() {
  h.tables.flow_pending_executions?.forEach((row) => {
    row.run_at = '2000-01-01T00:00:00.000Z';
  });
}
beforeEach(() => {
  h.tables = {
    flows: [{ ...flow }],
    flow_nodes: [
      node('confirmation', 'send_template', {
        next_node_key: 'wait',
        buttons: [{ reply_id: 'yes', title: 'Yes', next_node_key: 'thanks' }],
        ...timeout('reminder', 10),
      }),
      node('wait', 'wait', {
        amount: 15,
        unit: 'minutes',
        next_node_key: 'softcopy',
      }),
      node('softcopy', 'send_template', {
        buttons: [
          { reply_id: 'approve', title: 'Approve', next_node_key: 'thanks' },
        ],
        ...timeout('reminder'),
      }),
      node('thanks', 'send_message', { text: 'Thanks', next_node_key: 'end' }),
      node('reminder', 'send_message', {
        text: 'Reminder',
        next_node_key: 'end',
      }),
      node('end', 'end', {}),
    ],
  };
  h.sends = [];
  h.seq = 0;
});

describe('independent Next step and no-response timeout', () => {
  it('keeps a payment collection waiting when a customer says they paid', async () => {
    h.tables.flow_nodes.push(node('payment', 'collect_payment', {}));
    h.tables.flow_runs = [{ id: 'pay-run', account_id: 'account', flow_id: flow.id, user_id: 'user', contact_id: 'contact', conversation_id: 'conversation', current_node_key: 'payment', status: 'waiting', vars: {}, reprompt_count: 0 }];
    const result = await reply({ kind: 'text', text: 'I paid', meta_message_id: 'payment-claim' });
    expect(result.outcome).toBe('no_match');
    expect(h.tables.flow_runs[0]).toMatchObject({ status: 'waiting', reprompt_count: 0, current_node_key: 'payment' });
    expect(h.sends).toEqual([]);
  });

  it('supports timeout on a template with no quick-reply buttons', async () => {
    const config = h.tables.flow_nodes[0].config as Row;
    delete config.buttons;
    await start();
    expect(
      h.tables.flow_pending_executions.map((row) => row.execution_kind)
    ).toEqual(['reply_timeout', 'wait']);
    await reply({
      kind: 'text',
      text: 'Hello',
      meta_message_id: 'plain-template-reply',
    });
    expect(
      h.tables.flow_pending_executions.find(
        (row) => row.execution_kind === 'reply_timeout'
      )?.status
    ).toBe('failed');
  });

  it('captures input without executing its unconditional Next step twice', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'collect_input', {
      prompt_text: 'Your name?',
      var_key: 'name',
      next_node_key: 'reminder',
    });
    const root = await start();
    expect(h.sends).toEqual(['Your name?', 'Reminder']);
    await reply({
      kind: 'text',
      text: 'Ramya',
      meta_message_id: 'input-reply',
    });
    expect(h.sends).toEqual(['Your name?', 'Reminder']);
    expect(
      h.tables.flow_runs.find((row) => row.id === root.flow_run_id)?.vars
    ).toEqual({ name: 'Ramya' });
  });
  it('schedules the 15-minute path immediately while keeping the first buttons active', async () => {
    const root = await start();
    expect(root.ok).toBe(true);
    expect(h.sends).toEqual(['confirmation']);
    const wait = h.tables.flow_pending_executions.find(
      (row) => row.execution_kind === 'wait'
    )!;
    expect(
      new Date(String(wait.run_at)).getTime() - Date.now()
    ).toBeGreaterThan(14 * 60_000);
    expect(wait.flow_run_id).not.toBe(root.flow_run_id);
    expect(
      h.tables.flow_runs.find((row) => row.id === root.flow_run_id)
        ?.current_node_key
    ).toBe('confirmation');
    due();
    await resumeFlowPendingExecutions();
    expect(h.sends).toContain('softcopy');
  });

  it('keeps the follow-up when a button reply finishes its original run', async () => {
    await start();
    await reply({
      kind: 'interactive_reply',
      reply_id: 'yes',
      reply_title: 'Yes',
      meta_message_id: 'reply-1',
    });
    expect(h.sends).toContain('Thanks');
    expect(
      h.tables.flow_pending_executions.find(
        (row) => row.execution_kind === 'wait'
      )?.status
    ).toBe('pending');
    due();
    await resumeFlowPendingExecutions();
    expect(h.sends).toContain('softcopy');
    expect(h.sends).not.toContain('Reminder');
  });

  it('cancels timeouts for any typed response without cancelling unconditional waits', async () => {
    await start();
    await reply({
      kind: 'text',
      text: 'I have a question',
      meta_message_id: 'reply-2',
    });
    expect(
      h.tables.flow_pending_executions
        .filter((row) => row.execution_kind === 'reply_timeout')
        .every((row) => row.status === 'failed')
    ).toBe(true);
    due();
    await resumeFlowPendingExecutions();
    expect(h.sends).toContain('softcopy');
    expect(h.sends).not.toContain('Reminder');
    await reply({
      kind: 'text',
      text: 'Checking the design',
      meta_message_id: 'reply-3',
    });
    due();
    await resumeFlowPendingExecutions();
    expect(h.sends).not.toContain('Reminder');
  });

  it('fires a timeout on silence and does not repeat sends when cron runs again', async () => {
    await start();
    due();
    await resumeFlowPendingExecutions();
    expect(h.sends).toContain('Reminder');
    expect(h.sends).toContain('softcopy');
    const sends = [...h.sends];
    // The newly created softcopy timeout is not due yet.
    await resumeFlowPendingExecutions();
    expect(h.sends).toEqual(sends);
  });

  it('runs an immediate Next step once and retains button reply handling', async () => {
    (h.tables.flow_nodes[0].config as Row).next_node_key = 'reminder';
    await start();
    expect(h.sends).toEqual(['confirmation', 'Reminder']);
    await reply({
      kind: 'interactive_reply',
      reply_id: 'yes',
      reply_title: 'Yes',
      meta_message_id: 'reply-4',
    });
    expect(h.sends).toEqual(['confirmation', 'Reminder', 'Thanks']);
  });
});
