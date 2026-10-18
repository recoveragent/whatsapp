import { createElement, type ReactNode } from 'react';

/** Render message markup as React text nodes, never as HTML. */
export function WhatsAppFormattedText({ text }: { text: string }) {
  return <>{formatText(text)}</>;
}

function formatText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /```([\s\S]+?)```|`([^`\n]+)`|(?<![\p{L}\p{N}])([*_~])(?=\S)([^\n]*?\S)\3(?![\p{L}\p{N}])/gu;
  let offset = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    parts.push(text.slice(offset, index));
    const [, monospace, inlineCode, marker, content] = match;
    if (monospace !== undefined || inlineCode !== undefined) {
      parts.push(
        <code key={index} className="font-mono">
          {monospace ?? inlineCode}
        </code>,
      );
    } else {
      const tag = marker === '*' ? 'strong' : marker === '_' ? 'em' : 's';
      parts.push(createElement(tag, { key: index }, ...formatText(content)));
    }
    offset = index + match[0].length;
  }
  parts.push(text.slice(offset));
  return parts;
}
