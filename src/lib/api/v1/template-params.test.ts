import { describe, expect, it } from 'vitest';

import type { MessageTemplate } from '@/types';
import {
  deriveTemplateParamSlots,
  humanizeTemplateName,
  resolveSendTimeParams,
  toPublicTemplateSummary,
} from './template-params';

const baseTemplate: MessageTemplate = {
  id: 'uuid',
  user_id: 'user',
  name: 'cod_call_not_connected_v1',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Hi {{1}}, your order {{2}} for {{3}} needs confirmation.',
  created_at: new Date().toISOString(),
};

describe('humanizeTemplateName', () => {
  it('title-cases snake_case template names', () => {
    expect(humanizeTemplateName('cod_call_not_connected_v1')).toBe(
      'Cod Call Not Connected V1',
    );
  });
});

describe('deriveTemplateParamSlots', () => {
  it('returns body slots for body variables', () => {
    expect(deriveTemplateParamSlots(baseTemplate)).toEqual([
      'body_1',
      'body_2',
      'body_3',
    ]);
  });

  it('includes header slots when required', () => {
    const template: MessageTemplate = {
      ...baseTemplate,
      header_type: 'image',
      body_text: 'Hello {{1}}',
    };
    expect(deriveTemplateParamSlots(template)).toEqual(['header_media', 'body_1']);
  });
});

describe('toPublicTemplateSummary', () => {
  it('uses Meta template name as public id', () => {
    const summary = toPublicTemplateSummary(baseTemplate);
    expect(summary.id).toBe('cod_call_not_connected_v1');
    expect(summary.param_count).toBe(3);
    expect(summary.params).toEqual(['body_1', 'body_2', 'body_3']);
  });
});

describe('resolveSendTimeParams', () => {
  it('maps array params to body values', () => {
    expect(
      resolveSendTimeParams(baseTemplate, ['Rahul', '#1234', 'Blue Tee']),
    ).toEqual({ body: ['Rahul', '#1234', 'Blue Tee'] });
  });

  it('maps object params by slot names', () => {
    expect(
      resolveSendTimeParams(baseTemplate, {
        body_1: 'Rahul',
        body_2: '#1234',
        body_3: 'Blue Tee',
      }),
    ).toEqual({
      body: ['Rahul', '#1234', 'Blue Tee'],
      headerMediaRequired: false,
      headerText: undefined,
      headerMediaUrl: undefined,
      buttonParams: undefined,
    });
  });

  it('falls back to Recover Agent semantic field order', () => {
    expect(
      resolveSendTimeParams(baseTemplate, {
        customer_name: 'Rahul',
        order_name: '#1234',
        product: 'Blue Tee',
        amount: '1299',
      }),
    ).toEqual({
      body: ['Rahul', '#1234', 'Blue Tee'],
      headerMediaRequired: false,
      headerText: undefined,
      headerMediaUrl: undefined,
      buttonParams: undefined,
    });
  });

  it('maps recording_url to header media', () => {
    const template: MessageTemplate = {
      ...baseTemplate,
      header_type: 'image',
      body_text: 'Listen here',
    };
    expect(
      resolveSendTimeParams(template, {
        recording_url: 'https://cdn.example/rec.mp3',
      }),
    ).toMatchObject({
      headerMediaUrl: 'https://cdn.example/rec.mp3',
      headerMediaRequired: true,
    });
  });
});
