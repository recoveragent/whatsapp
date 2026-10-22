import { describe, expect, it } from 'vitest';
import {
  missingVariableFallbacks,
  preserveVariableFallbacks,
  setVariableFallback,
  variableFallbacks,
  withoutVariableFallbacks,
} from './variable-fallback';
import { interpolateTemplateString } from './template-interpolate';
import { validateFlowForActivation } from './validate';
import { validateStepsForActivation } from '@/lib/automations/validate';

describe('required variable fallbacks', () => {
  it('round trips punctuation, quotes, backslashes and line breaks through the UI and runtime', () => {
    const fallback = 'Nirog "Mart" \\ shop\nWelcome';
    const value = setVariableFallback(
      '{{ vars.company }}',
      'vars.company',
      fallback
    );
    expect(variableFallbacks(value)).toEqual([
      { key: 'vars.company', fallback },
    ]);
    expect(withoutVariableFallbacks(value)).toBe('{{ vars.company }}');
    expect(interpolateTemplateString(value, {})).toBe(fallback);
    expect(
      interpolateTemplateString(value, { company: 'Actual company' })
    ).toBe('Actual company');
    expect(interpolateTemplateString(value, { company: '   ' })).toBe(fallback);
  });

  it('preserves fallbacks while editing surrounding text and supports multiple variables', () => {
    const previous =
      '{{ vars.name | "there" }} from {{ vars.company | "our store" }}';
    expect(preserveVariableFallbacks('Hi {{ vars.name }}!', previous)).toBe(
      'Hi {{ vars.name | "there" }}!'
    );
    expect(missingVariableFallbacks(previous)).toEqual([]);
    expect(
      missingVariableFallbacks(
        setVariableFallback(previous, 'vars.company', '')
      )
    ).toEqual([{ path: '', key: 'vars.company' }]);
  });

  it('requires a nonblank literal fallback for every nested mapping', () => {
    expect(
      missingVariableFallbacks({
        request_template: {
          variables: {
            1: '{{ trigger.name }}',
            button_0: '{{ vars.payment_url_suffix }}',
          },
        },
      })
    ).toHaveLength(2);
    expect(missingVariableFallbacks('{{ vars.name | "   " }}')).toHaveLength(1);
    expect(missingVariableFallbacks('Static text')).toEqual([]);
  });

  it('blocks flow and automation activation until fallbacks are supplied', () => {
    const flow = {
      name: 'Test',
      trigger_type: 'manual' as const,
      trigger_config: {},
      entry_node_id: 'send',
    };
    const config = { text: 'Hi {{ vars.name }}', next_node_key: 'end' };
    const nodes = [
      { node_key: 'send', node_type: 'send_message', config },
      { node_key: 'end', node_type: 'end', config: {} },
    ];
    expect(
      validateFlowForActivation(flow, nodes).some((issue) =>
        issue.message.includes('required fallback')
      )
    ).toBe(true);
    expect(
      validateStepsForActivation([
        { step_type: 'send_message', step_config: config },
      ]).some((issue) => issue.message.includes('required fallback'))
    ).toBe(true);
    config.text = 'Hi {{ vars.name | "there" }}';
    expect(validateFlowForActivation(flow, nodes)).toEqual([]);
    expect(
      validateStepsForActivation([
        { step_type: 'send_message', step_config: config },
      ])
    ).toEqual([]);
  });
});
