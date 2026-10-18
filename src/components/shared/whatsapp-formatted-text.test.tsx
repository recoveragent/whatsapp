import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhatsAppFormattedText } from './whatsapp-formatted-text';

const render = (text: string) =>
  renderToStaticMarkup(createElement(WhatsAppFormattedText, { text }));

describe('WhatsApp preview formatting', () => {
  it('renders the template emphasis and variable without markers', () => {
    expect(render('*Some intentions are worth coming back to!* 🌸\nOrder *{{2}}*.'))
      .toBe('<strong>Some intentions are worth coming back to!</strong> 🌸\nOrder <strong>{{2}}</strong>.');
  });

  it('supports nested emphasis, strike and literal monospace', () => {
    expect(render('*bold _italic_* ~old~ ```*literal*``` `code`'))
      .toBe('<strong>bold <em>italic</em></strong> <s>old</s> <code class="font-mono">*literal*</code> <code class="font-mono">code</code>');
  });

  it('preserves plain text, line breaks, incomplete markup and HTML safety', () => {
    expect(render('order_shipped\n*unfinished <img src=x>'))
      .toBe('order_shipped\n*unfinished &lt;img src=x&gt;');
  });
});
