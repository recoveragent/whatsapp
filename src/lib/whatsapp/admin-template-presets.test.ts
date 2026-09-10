import { describe, expect, it } from 'vitest';

import { validateTemplatePayload } from './template-validators';
import {
  listAdminTemplatePresets,
  presetToFormData,
} from './admin-template-presets';

describe('admin template presets', () => {
  it('lists all presets with unique slugs and names', () => {
    const presets = listAdminTemplatePresets();
    expect(presets.length).toBeGreaterThanOrEqual(4);
    const slugs = presets.map((p) => p.slug);
    const names = presets.map((p) => p.name);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('validates each preset except those needing media URLs at push time', () => {
    for (const preset of listAdminTemplatePresets()) {
      const form = presetToFormData(preset);
      if (form.header_format === 'image' && !form.header_media_url.trim()) {
        continue;
      }
      expect(() =>
        validateTemplatePayload({
          name: form.name,
          category: form.category,
          language: form.language,
          header_type:
            form.header_format === 'none' ? undefined : form.header_format,
          header_content:
            form.header_format === 'text' ? form.header_content : undefined,
          header_media_url:
            form.header_format !== 'none' && form.header_format !== 'text'
              ? form.header_media_url || undefined
              : undefined,
          body_text: form.body_text,
          footer_text: form.footer_text || undefined,
          buttons: form.buttons.length > 0 ? form.buttons : undefined,
          sample_values: form.body_samples.some((v) => v.trim())
            ? { body: form.body_samples }
            : undefined,
        }),
      ).not.toThrow();
    }
  });
});
