import { describe, expect, it } from 'vitest';

import type { Contact } from '@/types';

import { resolveVariable, resolveVariables, broadcastFallbackText, broadcastCustomFieldToken } from './broadcast-variables';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    user_id: '',
    account_id: '',
    name: 'Asha',
    phone: '+919800000000',
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Contact;
}

describe('resolveVariable', () => {
  it('interpolates typed text and user attribute tokens per contact', () => {
    const mapping = { type: 'custom_field', value: 'missing', fallback: 'Hello {{ vars.first_name }} {{ vars.last_name }}' } as const;
    expect(resolveVariable(mapping, contact({ name: 'Asha Sharma' }))).toBe('Hello Asha Sharma');
    expect(resolveVariable(mapping, contact({ name: 'Dev Kumar' }))).toBe('Hello Dev Kumar');
  });

  it('resolves missing user attributes and inline defaults', () => {
    expect(resolveVariable({ type: 'field', value: 'name', fallback: '{{ vars.email }}' }, contact({ name: '' }))).toBe('');
    expect(resolveVariable({ type: 'field', value: 'name', fallback: '{{ vars.first_name | "friend" }}' }, contact({ name: '' }))).toBe('friend');
  });

  it('inserts custom attribute tokens and displays legacy fallbacks as tokens', () => {
    const token = broadcastCustomFieldToken('abc-123');
    expect(resolveVariable({ type: 'field', value: 'name', fallback: token }, contact({ name: '' }), new Map([['abc-123', 'Gold']]))).toBe('Gold');
    expect(broadcastFallbackText({ type: 'field', value: 'name', fallbackType: 'field', fallback: 'phone' })).toBe('{{ vars.phone }}');
    expect(broadcastFallbackText({ type: 'field', value: 'name', fallbackType: 'custom_field', fallback: 'abc-123' })).toBe(token);
  });
  it('uses the contact field when it has a value', () => {
    expect(
      resolveVariable(
        { type: 'field', value: 'name', fallback: 'Ji' },
        contact()
      )
    ).toBe('Asha');
  });

  it('uses the fallback when the contact field is empty', () => {
    expect(
      resolveVariable(
        { type: 'field', value: 'name', fallback: 'Ji' },
        contact({ name: '' })
      )
    ).toBe('Ji');
  });

  it('treats a whitespace-only or missing field as empty', () => {
    const mapping = { type: 'field', value: 'name', fallback: 'Ji' } as const;
    expect(resolveVariable(mapping, contact({ name: '   ' }))).toBe('Ji');
    expect(
      resolveVariable(
        mapping,
        contact({ name: undefined as unknown as string })
      )
    ).toBe('Ji');
  });

  it('stays empty when the field is empty and there is no fallback', () => {
    expect(
      resolveVariable({ type: 'field', value: 'name' }, contact({ name: '' }))
    ).toBe('');
    expect(
      resolveVariable(
        { type: 'field', value: 'name', fallback: '  ' },
        contact({ name: '' })
      )
    ).toBe('');
  });

  it('applies the fallback to custom fields', () => {
    const mapping = {
      type: 'custom_field',
      value: 'f1',
      fallback: 'friend',
    } as const;
    expect(resolveVariable(mapping, contact(), new Map([['f1', 'Gold']]))).toBe(
      'Gold'
    );
    expect(resolveVariable(mapping, contact(), new Map([['f1', '']]))).toBe(
      'friend'
    );
    expect(resolveVariable(mapping, contact(), new Map())).toBe('friend');
  });

  it('ignores the fallback for static values', () => {
    expect(
      resolveVariable({ type: 'static', value: 'Ji', fallback: 'x' }, contact())
    ).toBe('Ji');
  });

  it('resolves a contact attribute fallback for each recipient', () => {
    const mapping = {
      type: 'field',
      value: 'name',
      fallbackType: 'field',
      fallback: 'phone',
    } as const;
    expect(resolveVariable(mapping, contact())).toBe('Asha');
    expect(resolveVariable(mapping, contact({ name: '' }))).toBe(
      '+919800000000'
    );
    expect(resolveVariable(mapping, contact({ name: '', phone: '222' }))).toBe(
      '222'
    );
  });

  it('resolves custom attribute fallbacks and leaves missing attributes empty', () => {
    const mapping = {
      type: 'custom_field',
      value: 'f1',
      fallbackType: 'custom_field',
      fallback: 'f2',
    } as const;
    expect(resolveVariable(mapping, contact(), new Map([['f2', 'Gold']]))).toBe(
      'Gold'
    );
    expect(resolveVariable(mapping, contact(), new Map([['f2', '  ']]))).toBe(
      ''
    );
    expect(resolveVariable(mapping, contact())).toBe('');
  });

  it('supports explicitly typed fallback text', () => {
    expect(
      resolveVariable(
        {
          type: 'field',
          value: 'name',
          fallbackType: 'static',
          fallback: ' friend ',
        },
        contact({ name: '' })
      )
    ).toBe('friend');
  });
});

describe('resolveVariables', () => {
  it('orders params numerically and applies fallbacks per contact', () => {
    const variables = {
      '10': { type: 'static', value: 'ten' },
      '1': { type: 'field', value: 'name', fallback: 'Ji' },
      '2': { type: 'static', value: 'two' },
    } as const;
    expect(resolveVariables(variables, contact({ name: '' }))).toEqual([
      'Ji',
      'two',
      'ten',
    ]);
  });
});
