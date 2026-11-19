import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluatePageRules,
  normalizePageRule,
  pageRuleMatches,
  parsePageRules,
  type PageRule,
  type PageRules,
} from './page-rules';

/** The plain-JS copy that ships in public/widget.js, pulled out by its markers. */
function loadWidgetCopy(): (rules: unknown, href: string) => boolean {
  const source = readFileSync(path.join(process.cwd(), 'public/widget.js'), 'utf8');
  const match = source.match(/\/\/ page-rules:start[^\n]*\n([\s\S]*?)\/\/ page-rules:end/);
  if (!match) throw new Error('page-rules markers missing from widget.js');
  return new Function(`${match[1]}\nreturn pageRulesAllow;`)();
}
const widgetAllows = loadWidgetCopy();

const rule = (type: PageRule['type'], value: string): PageRule => ({ type, value });

describe('pageRuleMatches', () => {
  it.each([
    [rule('contains', '/products/'), 'https://s.com/products/tee', true],
    [rule('contains', '/products/'), 'https://s.com/fr/products/tee', true],
    [rule('contains', '/products/'), 'https://s.com/collections/all', false],
    [rule('exact', '/'), 'https://s.com/', true],
    [rule('exact', '/'), 'https://s.com/?utm_source=x', true],
    [rule('exact', '/cart'), 'https://s.com/Cart/', true],
    [rule('exact', '/cart'), 'https://s.com/cart/change', false],
    [rule('starts_with', '/account'), 'https://s.com/account/login', true],
    [rule('starts_with', '/account'), 'https://s.com/my/account', false],
    [rule('pattern', '/collections/*/products/*'), 'https://s.com/collections/sale/products/tee', true],
    [rule('pattern', '/collections/*/products/*'), 'https://s.com/products/tee', false],
    [rule('pattern', '/products/*'), 'https://s.com/products', false],
    [rule('pattern', '/a.b'), 'https://s.com/axb', false],
    [rule('contains', 'ref=ads'), 'https://s.com/x?ref=ads', false],
    [rule('contains', '?ref=ads'), 'https://s.com/x?ref=ads', true],
    [rule('regex', '^/pages/(faq|help)$'), 'https://s.com/pages/FAQ', true],
    [rule('regex', '^/pages/(faq|help)$'), 'https://s.com/pages/about', false],
    [rule('regex', '('), 'https://s.com/', false],
  ])('%o on %s → %s (both copies)', (r, url, expected) => {
    expect(pageRuleMatches(r, url)).toBe(expected);
    const asOnly: PageRules = { show: 'only', include: [r], exclude: [] };
    expect(widgetAllows(asOnly, url)).toBe(expected);
  });
});

describe('evaluatePageRules', () => {
  const rules: PageRules = {
    show: 'only',
    include: [rule('contains', '/products/'), rule('exact', '/')],
    exclude: [rule('contains', 'gift-card')],
  };

  it.each([
    ['https://s.com/', true, 'included'],
    ['https://s.com/products/tee', true, 'included'],
    ['https://s.com/products/gift-card', false, 'excluded'],
    ['https://s.com/cart', false, 'not_included'],
  ])('%s → visible %s (%s)', (url, visible, reason) => {
    const verdict = evaluatePageRules(rules, url);
    expect(verdict).toMatchObject({ visible, reason });
    expect(widgetAllows(rules, url)).toBe(visible);
  });

  it('shows everywhere but exclusions under "all"', () => {
    const all: PageRules = { show: 'all', include: [], exclude: [rule('starts_with', '/checkout')] };
    expect(evaluatePageRules(all, '/anything').visible).toBe(true);
    expect(evaluatePageRules(all, '/checkout/1').visible).toBe(false);
    expect(widgetAllows(all, 'https://s.com/anything')).toBe(true);
    expect(widgetAllows(all, 'https://s.com/checkout/1')).toBe(false);
  });

  it('widget copy treats missing rules as all pages', () => {
    expect(widgetAllows(undefined, 'https://s.com/x')).toBe(true);
    expect(widgetAllows(null, 'https://s.com/x')).toBe(true);
  });
});

describe('normalizePageRule', () => {
  it.each([
    [{ type: 'exact', value: 'https://Store.com/Cart/' }, rule('exact', '/cart')],
    [{ type: 'starts_with', value: 'account' }, rule('starts_with', '/account')],
    [{ type: 'contains', value: ' Sale ' }, rule('contains', 'sale')],
    [{ type: 'pattern', value: '*/products/*' }, rule('pattern', '*/products/*')],
    [{ type: 'regex', value: '^/Pages/' }, rule('regex', '^/Pages/')],
  ])('%o → %o', (input, expected) => {
    expect(normalizePageRule(input)).toEqual(expected);
  });

  it.each([
    [{ type: 'contains', value: '  ' }],
    [{ type: 'nope', value: '/x' }],
    [{ type: 'regex', value: '(' }],
    [{ type: 'contains', value: 'x'.repeat(301) }],
  ])('rejects %o', (input) => {
    expect(typeof normalizePageRule(input)).toBe('string');
  });
});

describe('parsePageRules', () => {
  it('defaults when missing', () => {
    expect(parsePageRules(undefined)).toEqual({ show: 'all', include: [], exclude: [] });
  });

  it('requires an include rule in "only" mode', () => {
    expect(typeof parsePageRules({ show: 'only', include: [], exclude: [] })).toBe('string');
  });

  it('drops duplicates and caps the count', () => {
    expect(
      parsePageRules({
        show: 'all',
        include: [],
        exclude: [rule('contains', 'x'), { type: 'contains', value: 'X' }],
      })
    ).toEqual({ show: 'all', include: [], exclude: [rule('contains', 'x')] });
    const many = Array.from({ length: 51 }, (_, i) => rule('contains', `p${i}`));
    expect(typeof parsePageRules({ show: 'all', include: [], exclude: many })).toBe('string');
  });
});
