/**
 * Which pages of the merchant's site show the chat widget.
 *
 * Rules match the page path (plus `?query` only when a rule mentions one),
 * case-insensitively, so UTM tags and domain differences never break them.
 * The domain itself is already gated by `allowed_domains`.
 *
 * public/widget.js carries a plain-JS copy of `pageRulesAllow`; keep the two
 * in step (page-rules.test.ts runs the same cases against both).
 */

export const PAGE_RULE_TYPES = [
  'contains',
  'exact',
  'starts_with',
  'pattern',
  'regex',
] as const;
export type PageRuleType = (typeof PAGE_RULE_TYPES)[number];

export interface PageRule {
  type: PageRuleType;
  value: string;
}

export interface PageRules {
  /** `all`: every page unless excluded. `only`: just the `include` matches. */
  show: 'all' | 'only';
  include: PageRule[];
  /** Always wins over `include`. */
  exclude: PageRule[];
}

export const DEFAULT_PAGE_RULES: PageRules = { show: 'all', include: [], exclude: [] };
export const PAGE_RULES_MAX = 50;
export const PAGE_RULE_MAX_CHARS = 300;

/** Lowercase path, trailing slash dropped (root stays "/"), query kept apart. */
function pageTarget(url: string): { path: string; search: string } {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://example.invalid');
  } catch {
    return { path: '/', search: '' };
  }
  let path = parsed.pathname.toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
  return { path, search: parsed.search.toLowerCase() };
}

function escapeRegex(text: string) {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function pageRuleMatches(rule: PageRule, url: string): boolean {
  const { path, search } = pageTarget(url);
  const value = rule.value;
  const target = rule.type === 'regex' || value.includes('?') ? path + search : path;
  switch (rule.type) {
    case 'contains':
      return target.includes(value);
    case 'exact':
      return target === value;
    case 'starts_with':
      return target.startsWith(value);
    case 'pattern':
      return new RegExp(
        '^' + value.split('*').map(escapeRegex).join('.*') + '$'
      ).test(target);
    case 'regex':
      try {
        return new RegExp(value, 'i').test(target);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export interface PageRulesVerdict {
  visible: boolean;
  /** The rule that decided it, or null when no rule was involved. */
  rule: PageRule | null;
  reason: 'excluded' | 'included' | 'all_pages' | 'not_included';
}

export function evaluatePageRules(rules: PageRules, url: string): PageRulesVerdict {
  const excluded = rules.exclude.find((rule) => pageRuleMatches(rule, url));
  if (excluded) return { visible: false, rule: excluded, reason: 'excluded' };
  if (rules.show === 'all') return { visible: true, rule: null, reason: 'all_pages' };
  const included = rules.include.find((rule) => pageRuleMatches(rule, url));
  return included
    ? { visible: true, rule: included, reason: 'included' }
    : { visible: false, rule: null, reason: 'not_included' };
}

/**
 * Tidy one rule as the merchant typed it. A pasted full URL becomes its path,
 * values are lowercased (regex keeps its case but matches with `i`), and
 * path-shaped rules lose their trailing slash so they line up with pages.
 * Returns an error message instead when the rule can't be used.
 */
export function normalizePageRule(raw: unknown): PageRule | string {
  if (!raw || typeof raw !== 'object') return 'Invalid page rule';
  const { type, value } = raw as Record<string, unknown>;
  if (!PAGE_RULE_TYPES.includes(type as PageRuleType)) return 'Invalid page rule type';
  if (typeof value !== 'string') return 'Invalid page rule';
  let text = value.trim();
  if (!text) return 'Page rules cannot be empty';
  if (text.length > PAGE_RULE_MAX_CHARS)
    return `Page rules must be at most ${PAGE_RULE_MAX_CHARS} characters`;

  if (type === 'regex') {
    try {
      new RegExp(text, 'i');
    } catch {
      return `"${text.slice(0, 60)}" is not a valid regular expression`;
    }
    return { type, value: text };
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = url.pathname + url.search;
    } catch {
      return `"${text.slice(0, 60)}" is not a valid URL`;
    }
  }
  text = text.toLowerCase();
  if (type !== 'contains' && !text.startsWith('/') && !text.startsWith('*'))
    text = '/' + text;
  if (type === 'exact' && text.length > 1 && !text.includes('?'))
    text = text.replace(/\/+$/, '') || '/';
  return { type: type as PageRuleType, value: text };
}

/** Validate the whole block from the settings form. */
export function parsePageRules(raw: unknown): PageRules | string {
  if (raw == null) return DEFAULT_PAGE_RULES;
  if (typeof raw !== 'object') return 'Invalid page rules';
  const { show, include, exclude } = raw as Record<string, unknown>;
  if (show !== 'all' && show !== 'only') return 'Invalid page rules';
  if (!Array.isArray(include) || !Array.isArray(exclude)) return 'Invalid page rules';
  if (include.length + exclude.length > PAGE_RULES_MAX)
    return `Add at most ${PAGE_RULES_MAX} page rules`;
  const result: PageRules = { show, include: [], exclude: [] };
  for (const [list, out] of [
    [include, result.include],
    [exclude, result.exclude],
  ] as const) {
    for (const entry of list) {
      const rule = normalizePageRule(entry);
      if (typeof rule === 'string') return rule;
      if (!out.some((r) => r.type === rule.type && r.value === rule.value)) out.push(rule);
    }
  }
  if (show === 'only' && result.include.length === 0)
    return 'Add at least one page to show the widget on, or choose "All pages"';
  return result;
}

/** Stored JSON is trusted but may predate a field; never throw on it. */
export function coercePageRules(raw: unknown): PageRules {
  const parsed = parsePageRules(raw);
  return typeof parsed === 'string' ? DEFAULT_PAGE_RULES : parsed;
}

/** One-click rules for common Shopify page types. */
export const PAGE_RULE_PRESETS: { label: string; rule: PageRule }[] = [
  { label: 'Home page', rule: { type: 'exact', value: '/' } },
  { label: 'Product pages', rule: { type: 'contains', value: '/products/' } },
  { label: 'Collections', rule: { type: 'contains', value: '/collections/' } },
  { label: 'Cart', rule: { type: 'starts_with', value: '/cart' } },
  { label: 'Account', rule: { type: 'starts_with', value: '/account' } },
  { label: 'Blog', rule: { type: 'contains', value: '/blogs/' } },
  { label: 'Search', rule: { type: 'starts_with', value: '/search' } },
  { label: 'Info pages', rule: { type: 'contains', value: '/pages/' } },
];
