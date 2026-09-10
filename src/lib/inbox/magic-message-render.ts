export const MAGIC_MESSAGE_MAX_CHARS = 2000;
export const MAGIC_MESSAGE_RECOMMENDED_CHARS = 500;

const CANVAS_WIDTH = 800;
const HORIZONTAL_PADDING = 40;
const VERTICAL_PADDING = 36;
const FONT_SIZE = 28;
const LINE_HEIGHT = 1.45;
const MAX_TEXT_WIDTH = CANVAS_WIDTH - HORIZONTAL_PADDING * 2;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function wrapMagicMessageLines(
  text: string,
  maxCharsPerLine = 42,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];

  const lines: string[] = [];

  for (const paragraph of normalized.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);
      if (word.length <= maxCharsPerLine) {
        current = word;
        continue;
      }

      for (let i = 0; i < word.length; i += maxCharsPerLine) {
        lines.push(word.slice(i, i + maxCharsPerLine));
      }
      current = '';
    }

    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

export function buildMagicMessageSvg(text: string): {
  svg: string;
  width: number;
  height: number;
} {
  const lines = wrapMagicMessageLines(text);
  const lineHeightPx = Math.round(FONT_SIZE * LINE_HEIGHT);
  const height =
    VERTICAL_PADDING * 2 + Math.max(1, lines.length) * lineHeightPx;

  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeightPx;
      return `<tspan x="${HORIZONTAL_PADDING}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${height}" viewBox="0 0 ${CANVAS_WIDTH} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text
    x="${HORIZONTAL_PADDING}"
    y="${VERTICAL_PADDING + FONT_SIZE}"
    fill="#111111"
    font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    font-size="${FONT_SIZE}px"
    xml:space="preserve"
  >${tspans}</text>
</svg>`;

  return { svg, width: CANVAS_WIDTH, height };
}

export async function renderMagicMessagePng(text: string): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Message text is required');
  }
  if (trimmed.length > MAGIC_MESSAGE_MAX_CHARS) {
    throw new Error(
      `Message exceeds the ${MAGIC_MESSAGE_MAX_CHARS}-character limit`,
    );
  }

  const { svg } = buildMagicMessageSvg(trimmed);
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
