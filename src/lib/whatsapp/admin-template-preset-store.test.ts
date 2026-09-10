import { describe, expect, it } from 'vitest';

import { getAdminTemplatePreset } from './admin-template-presets';
import {
  editorSnapshotsEqual,
  presetToEditorSnapshot,
  presetViewToFormData,
  validatePresetPayload,
} from './admin-template-preset-store';

describe('admin template preset store', () => {
  it('round-trips preset form data for equality checks', () => {
    const base = getAdminTemplatePreset('order_confirmation');
    expect(base).not.toBeNull();
    const view = { ...base!, has_override: false, is_custom: false };
    const snapshot = presetToEditorSnapshot(view);
    expect(editorSnapshotsEqual(snapshot, presetToEditorSnapshot(view))).toBe(
      true,
    );
    expect(presetViewToFormData(view)).toEqual(snapshot.form);
  });

  it('validates a saved preset payload without media URL for image headers', () => {
    const base = getAdminTemplatePreset('order_placed_cod');
    expect(base).not.toBeNull();
    const form = presetViewToFormData({
      ...base!,
      has_override: false,
      is_custom: false,
    });
    expect(() => validatePresetPayload(form)).not.toThrow();
  });
});
