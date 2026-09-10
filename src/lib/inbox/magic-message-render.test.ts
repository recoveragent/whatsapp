import { describe, expect, it } from 'vitest';

import {
  buildMagicMessageSvg,
  escapeXml,
  wrapMagicMessageLines,
} from './magic-message-render';

describe('wrapMagicMessageLines', () => {
  it('wraps long lines and preserves paragraph breaks', () => {
    const lines = wrapMagicMessageLines(
      'Short line\nThis is a much longer sentence that should wrap across multiple visual lines when rendered',
      20,
    );

    expect(lines[0]).toBe('Short line');
    expect(lines.length).toBeGreaterThan(2);
  });
});

describe('buildMagicMessageSvg', () => {
  it('escapes unsafe characters in rendered text', () => {
    const { svg } = buildMagicMessageSvg('Hello <world> & "friends"');

    expect(svg).toContain('Hello &lt;world&gt; &amp; &quot;friends&quot;');
    expect(svg).toContain('fill="#ffffff"');
  });
});

describe('escapeXml', () => {
  it('escapes xml entities', () => {
    expect(escapeXml(`a & b <c> "d"`)).toBe('a &amp; b &lt;c&gt; &quot;d&quot;');
  });
});
