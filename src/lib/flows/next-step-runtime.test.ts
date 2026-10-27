import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowRow, ParsedInbound } from './types';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  sends: [] as string[],
  templateParams: [] as Array<Record<string, unknown>>,
  flowTokens: [] as string[],
  seq: 0,
  confirmRecoveryCod: vi.fn(),
  completeRecoveryOrder: vi.fn(),
}));
vi.mock('@/lib/shopify/recovery-orders', () => ({
  confirmRecoveryCod: h.confirmRecoveryCod,
  completeRecoveryOrder: h.completeRecoveryOrder,
  prepareRecoveryOrder: vi.fn(),
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
        return r.data.length > 1 ? { ...r, data: null, error: { code: 'PGRST116' } } : { ...r, data: r.data[0] ?? null };
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
  engineSendInteractiveButtons: vi.fn(async ({ bodyText }: { bodyText: string }) => {
    h.sends.push(bodyText);
    return { whatsapp_message_id: `wamid.${h.sends.length}` };
  }),
  engineSendText: vi.fn(async ({ text }: { text: string }) => {
    h.sends.push(text);
    return { whatsapp_message_id: `wamid.${h.sends.length}` };
  }),
  engineSendFlowMessage: vi.fn(async ({ bodyText, flowToken }: { bodyText: string; flowToken: string }) => {
    h.sends.push(bodyText);
    h.flowTokens.push(flowToken);
    return { whatsapp_message_id: `wamid.${h.sends.length}` };
  }),
}));
vi.mock('@/lib/automations/meta-send', () => ({
  engineSendTemplate: vi.fn(
    async ({ templateName, messageParams }: { templateName: string; messageParams: Record<string, unknown> }) => {
      h.sends.push(templateName);
      h.templateParams.push(messageParams);
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
  h.confirmRecoveryCod.mockReset().mockResolvedValue(undefined);
  h.completeRecoveryOrder.mockReset().mockResolvedValue({ id: 'recovery-1', summary: 'Shirt × 2; INR 250.00', amount_paise: 25000, shopify_order_id: '99', order_name: '#1099' });
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
  h.templateParams = [];
  h.flowTokens = [];
  h.seq = 0;
});

describe('independent Next step and no-response timeout', () => {
  it('displays the order summary and accepts COD creation only after a button tap', async () => {
    h.tables.flow_nodes = [
      node('confirmation', 'send_buttons', { text: '{{ vars.checkout_order_summary }}\nConfirm COD?', buttons: [{ reply_id: 'confirm_cod', title: 'Confirm COD order', next_node_key: 'place_cod' }] }),
      node('place_cod', 'recover_checkout', { action: 'place_cod', cod_mode: 'create_order', ready_next: 'thanks', checkout_next: 'end', failed_next: 'end' }),
      node('thanks', 'send_message', { text: 'Order placed', next_node_key: 'end' }), node('end', 'end', {}),
    ];
    await startFlowForExternalEvent({ flow, contactId: 'contact', conversationId: 'conversation', initialVars: { checkout_recovery_id: 'recovery-1', checkout_order_summary: 'Shirt × 2; INR 250.00' } });
    expect(h.sends[0]).toContain('Shirt × 2; INR 250.00');
    await reply({ kind: 'text', text: 'Confirm COD order', meta_message_id: 'typed-confirm' });
    expect(h.confirmRecoveryCod).not.toHaveBeenCalled();
    expect(h.completeRecoveryOrder).not.toHaveBeenCalled();
    await reply({ kind: 'interactive_reply', reply_id: 'confirm_cod', reply_title: 'Confirm COD order', meta_message_id: 'button-confirm' });
    expect(h.confirmRecoveryCod).toHaveBeenCalledTimes(1);
    expect(h.completeRecoveryOrder).toHaveBeenCalledTimes(1);
    expect(h.sends).toContain('Order placed');
  });
  it('uses the approved Cashfree template when a pending draft shares its name', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'send_template', { next_node_key: 'end', variables: {} });
    const approved = { status: 'APPROVED', id: 'tpl', user_id: 'user', account_id: 'account', name: 'confirmation', language: 'en_US', body_text: 'Advance.', buttons: [{ type: 'URL', text: 'Pay now', url: 'https://payments.cashfree.com/{{1}}', url_purpose: 'payment' }] };
    h.tables.message_templates = [approved, { ...approved, id: 'draft', status: 'PENDING' }];
    await startFlowForExternalEvent({ flow, contactId: 'contact', conversationId: 'conversation', initialVars: { payment_url: 'https://payments.cashfree.com/links/test', payment_url_suffix: 'links/test' } });
    expect(h.templateParams[0].buttonParams).toEqual({ 0: 'links/test' });
    expect(h.tables.flow_runs[0].status).toBe('completed');
  });

  it('rejects a Razorpay CTA for a Cashfree collection even when an unapproved duplicate exists', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'send_template', { next_node_key: 'end', variables: {} });
    h.tables.message_templates = [{ status: 'APPROVED', id: 'tpl', user_id: 'user', account_id: 'account', name: 'confirmation', language: 'en_US', body_text: 'Advance.', buttons: [{ type: 'URL', text: 'Pay now', url: 'https://rzp.io/{{1}}', url_purpose: 'payment' }] }];
    h.tables.message_templates.push({ ...h.tables.message_templates[0], id: 'draft', status: 'PENDING' });
    await startFlowForExternalEvent({ flow, contactId: 'contact', conversationId: 'conversation', initialVars: { payment_url: 'https://payments.cashfree.com/links/test', payment_url_suffix: 'links/test' } });
    expect(h.templateParams).toEqual([]);
    expect(h.tables.flow_runs[0].status).toBe('failed');
  });

  it('uses separate payment and courier URLs when a template contains both CTAs', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'send_template', { next_node_key: 'end', variables: {} });
    h.tables.message_templates = [{ status: 'APPROVED', id: 'tpl', user_id: 'user', account_id: 'account', name: 'confirmation', language: 'en_US', body_text: 'Order update.', buttons: [
      { type: 'URL', text: 'Pay now', url: 'https://rzp.io/{{1}}', url_purpose: 'payment' },
      { type: 'URL', text: 'Track order', url: 'https://crm.example.com/t/{{1}}', url_purpose: 'tracking' },
    ] }];
    await startFlowForExternalEvent({ flow, contactId: 'contact', conversationId: 'conversation', initialVars: { payment_url_suffix: 'rzp/deposit-link', tracking_url_redirect_suffix: 'tracking-token', order_status_url_suffix: 'orders/do-not-use' } });
    expect(h.templateParams[0].buttonParams).toEqual({ 0: 'rzp/deposit-link', 1: 'tracking-token' });
  });

  it('does not substitute an order URL when a payment CTA has no payment link', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'send_template', { next_node_key: 'end', variables: {} });
    h.tables.message_templates = [{ status: 'APPROVED', id: 'tpl', user_id: 'user', account_id: 'account', name: 'confirmation', language: 'en_US', body_text: 'Advance payment.', buttons: [{ type: 'URL', text: 'Pay now', url: 'https://rzp.io/{{1}}', url_purpose: 'payment' }] }];
    await startFlowForExternalEvent({ flow, contactId: 'contact', conversationId: 'conversation', initialVars: { order_status_url_suffix: 'orders/do-not-use' } });
    expect(h.templateParams).toEqual([]);
    expect(h.tables.flow_runs[0].status).toBe('failed');
  });

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

  it('waits for typed input before running Next step with the captured var', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'collect_input', {
      prompt_text: 'Your name?',
      var_key: 'name',
      next_node_key: 'greet',
    });
    h.tables.flow_nodes.push(node('greet', 'send_message', { text: 'Hi {{vars.name}}', next_node_key: 'end' }));
    const root = await start();
    expect(h.sends).toEqual(['Your name?']);
    await reply({ kind: 'text', text: 'Ramya', meta_message_id: 'input-reply' });
    expect(h.sends).toEqual(['Your name?', 'Hi Ramya']);
    expect(h.tables.flow_runs).toHaveLength(1);
    expect(h.tables.flow_runs.find((row) => row.id === root.flow_run_id)?.status).toBe('completed');
  });

  it('does not re-run Next step for a run whose Next step already started before the change', async () => {
    h.tables.flow_nodes[0] = node('confirmation', 'collect_input', {
      prompt_text: 'Your name?',
      var_key: 'name',
      next_node_key: 'reminder',
    });
    h.tables.flow_runs = [{ id: 'legacy', account_id: 'account', flow_id: flow.id, user_id: 'user', contact_id: 'contact', conversation_id: 'conversation', current_node_key: 'confirmation', status: 'active', vars: {}, reprompt_count: 0 }];
    h.tables.flow_run_events = [{ id: 'e1', flow_run_id: 'child', event_type: 'started', node_key: 'reminder', payload: { parent_run_id: 'legacy', source_node_key: 'confirmation' } }];
    await reply({ kind: 'text', text: 'Ramya', meta_message_id: 'legacy-reply' });
    expect(h.sends).toEqual([]);
    expect(h.tables.flow_runs[0]).toMatchObject({ status: 'completed', vars: { name: 'Ramya' } });
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

  it('fills contact attributes, spaced tokens and fallbacks in plain messages', async () => {
    h.tables.contacts = [{ id: 'contact', name: 'Asha Rao', phone: '+919999999999' }];
    h.tables.flow_nodes[0] = node('confirmation', 'send_message', {
      text: 'Hi {{ vars.first_name }} ({{vars.name}}), city: {{ vars.city | "unknown" }}',
      next_node_key: 'end',
    });
    await start();
    expect(h.sends).toEqual(['Hi Asha (Asha Rao), city: unknown']);
    expect(h.tables.flow_runs[0]!.vars).toEqual({});
  });

  it('uses the fallback when the contact has no name', async () => {
    h.tables.contacts = [{ id: 'contact', name: null }];
    h.tables.flow_nodes[0] = node('confirmation', 'send_message', {
      text: 'Hi {{ vars.first_name | "there" }}',
      next_node_key: 'end',
    });
    await start();
    expect(h.sends).toEqual(['Hi there']);
  });

  describe('Send WhatsApp form', () => {
    const RUN = '11111111-2222-4333-8444-555555555555';
    const OTHER = '99999999-2222-4333-8444-555555555555';
    function formNode() {
      return node('form', 'send_flow', {
        body_text: 'Fill this',
        flow_id: '123',
        flow_cta: 'Open',
        flow_screen: 'DETAILS',
        var_key: 'form',
        next_node_key: 'greet',
      });
    }
    function waitingRun(id: string, at: string) {
      return { id, account_id: 'account', flow_id: flow.id, user_id: 'user', contact_id: 'contact', conversation_id: 'conversation', current_node_key: 'form', status: 'active', vars: {}, reprompt_count: 0, last_advanced_at: at };
    }
    function submit(token: string | undefined, id = 'form-reply') {
      return reply({ kind: 'form_reply', formatted: 'Name: Asha', values: { full_name: 'Asha' }, flow_token: token, meta_message_id: id });
    }
    beforeEach(() => {
      h.tables.flow_nodes = [
        formNode(),
        node('greet', 'send_message', { text: 'Thanks {{vars.form.full_name}}', next_node_key: 'end' }),
        node('end', 'end', {}),
      ];
      h.tables.flows[0]!.entry_node_id = 'form';
    });

    it('waits for the submission, then runs Next step with the answers', async () => {
      await startFlowForExternalEvent({ flow: { ...flow, entry_node_id: 'form' }, contactId: 'contact', conversationId: 'conversation' });
      expect(h.sends).toEqual(['Fill this']);
      await submit(h.flowTokens[0]);
      expect(h.sends).toEqual(['Fill this', 'Thanks Asha']);
    });

    it('routes a submission to the run that sent the form, not the newest one', async () => {
      h.tables.flow_runs = [waitingRun(OTHER, '2026-10-20T10:00:00Z'), waitingRun(RUN, '2026-10-20T09:00:00Z')];
      await submit(`${RUN}:form:1`);
      expect(h.tables.flow_runs.find((r) => r.id === RUN)).toMatchObject({ status: 'completed', vars: { form: { full_name: 'Asha', formatted: 'Name: Asha' } } });
      expect(h.tables.flow_runs.find((r) => r.id === OTHER)?.status).toBe('active');
    });

    it('ignores a stale form whose run has moved on', async () => {
      h.tables.flow_runs = [waitingRun(OTHER, '2026-10-20T10:00:00Z')];
      const result = await submit(`${RUN}:form:1`);
      expect(result.outcome).toBe('no_match');
      expect(h.sends).toEqual([]);
      expect(h.tables.flow_runs[0]).toMatchObject({ status: 'active', vars: {} });
    });
  });
});
