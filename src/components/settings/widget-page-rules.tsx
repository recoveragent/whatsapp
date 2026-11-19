'use client';

import { useState } from 'react';
import { Eye, EyeOff, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  evaluatePageRules,
  normalizePageRule,
  PAGE_RULE_MAX_CHARS,
  PAGE_RULE_PRESETS,
  PAGE_RULES_MAX,
  type PageRule,
  type PageRules,
  type PageRuleType,
} from '@/lib/website-widget/page-rules';

const TYPE_LABELS: Record<PageRuleType, string> = {
  contains: 'URL contains',
  exact: 'URL is exactly',
  starts_with: 'URL starts with',
  pattern: 'URL matches pattern',
  regex: 'Regex (advanced)',
};

const PLACEHOLDERS: Record<PageRuleType, string> = {
  contains: '/products/',
  exact: '/cart',
  starts_with: '/blogs/',
  pattern: '/collections/*/products/*',
  regex: '^/pages/(faq|help)$',
};

const selectClass =
  'h-10 shrink-0 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60';

const describeRule = (rule: PageRule) => `${TYPE_LABELS[rule.type]} "${rule.value}"`;

function RuleList({
  label,
  hint,
  rules,
  disabled,
  canAdd,
  onChange,
}: {
  label: string;
  hint: string;
  rules: PageRule[];
  disabled: boolean;
  canAdd: boolean;
  onChange: (rules: PageRule[]) => void;
}) {
  const has = (rule: PageRule) =>
    rules.some((r) => r.type === rule.type && r.value === rule.value);
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {rules.map((rule, index) => {
        const problem = rule.value.trim() ? normalizePageRule(rule) : null;
        return (
          <div key={index} className="space-y-1">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label={`${label} rule ${index + 1} type`}
                className={selectClass}
                value={rule.type}
                disabled={disabled}
                onChange={(event) =>
                  onChange(rules.map((r, i) => (i === index ? { ...r, type: event.target.value as PageRuleType } : r)))
                }
              >
                {(Object.keys(TYPE_LABELS) as PageRuleType[]).map((type) => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
              <div className="flex flex-1 gap-2">
                <Input
                  aria-label={`${label} rule ${index + 1} value`}
                  maxLength={PAGE_RULE_MAX_CHARS}
                  placeholder={PLACEHOLDERS[rule.type]}
                  value={rule.value}
                  disabled={disabled}
                  className="font-mono text-xs"
                  onChange={(event) =>
                    onChange(rules.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Remove ${label.toLowerCase()} rule ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(rules.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            {typeof problem === 'string' && (
              <p className="text-xs text-destructive">{problem}</p>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !canAdd}
          onClick={() => onChange([...rules, { type: 'contains', value: '' }])}
        >
          <Plus className="mr-1 size-3.5" />
          Add rule
        </Button>
        {PAGE_RULE_PRESETS.filter((preset) => !has(preset.rule)).map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={disabled || !canAdd}
            onClick={() => onChange([...rules, preset.rule])}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            + {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WidgetPageRules({
  value,
  disabled,
  onChange,
}: {
  value: PageRules;
  disabled: boolean;
  onChange: (rules: PageRules) => void;
}) {
  const [testUrl, setTestUrl] = useState('');
  const canAdd = value.include.length + value.exclude.length < PAGE_RULES_MAX;

  // Preview against what is in the form now, unsaved, ignoring rules that
  // aren't usable yet (they're flagged inline).
  const usable = (rules: PageRule[]) =>
    rules.flatMap((rule) => {
      const normalized = rule.value.trim() ? normalizePageRule(rule) : null;
      return normalized && typeof normalized !== 'string' ? [normalized] : [];
    });
  const verdict = testUrl.trim()
    ? evaluatePageRules(
        { show: value.show, include: usable(value.include), exclude: usable(value.exclude) },
        testUrl.trim()
      )
    : null;

  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Where the widget appears</legend>
      <p className="text-xs text-muted-foreground">
        Rules check the page path, ignore upper/lower case, and ignore{' '}
        <code>?utm</code> tags unless the rule itself has a <code>?</code>. In a
        pattern, <code>*</code> matches anything.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        {(['all', 'only'] as const).map((show) => (
          <label
            key={show}
            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${value.show === show ? 'border-primary bg-primary/10 text-primary' : 'border-border'} ${disabled ? 'cursor-default opacity-60' : ''}`}
          >
            <input
              type="radio"
              name="widget-page-show"
              checked={value.show === show}
              disabled={disabled}
              onChange={() => onChange({ ...value, show })}
            />
            {show === 'all' ? 'All pages' : 'Only on specific pages'}
          </label>
        ))}
      </div>

      {value.show === 'only' && (
        <RuleList
          label="Show on"
          hint="The widget appears on pages matching any of these."
          rules={value.include}
          disabled={disabled}
          canAdd={canAdd}
          onChange={(include) => onChange({ ...value, include })}
        />
      )}

      <RuleList
        label="Never show on"
        hint="Always wins: pages matching any of these never show the widget."
        rules={value.exclude}
        disabled={disabled}
        canAdd={canAdd}
        onChange={(exclude) => onChange({ ...value, exclude })}
      />

      <div className="space-y-1.5 rounded-md bg-muted/40 p-3">
        <Label htmlFor="widget-page-test">Test a page</Label>
        <Input
          id="widget-page-test"
          placeholder="https://yourstore.com/products/blue-tee"
          value={testUrl}
          onChange={(event) => setTestUrl(event.target.value)}
        />
        {verdict && (
          <p
            role="status"
            className={`flex items-start gap-1.5 text-xs ${verdict.visible ? 'text-primary' : 'text-destructive'}`}
          >
            {verdict.visible ? <Eye className="mt-px size-3.5 shrink-0" /> : <EyeOff className="mt-px size-3.5 shrink-0" />}
            <span>
              <strong>{verdict.visible ? 'Visible' : 'Hidden'}</strong>
              {' — '}
              {verdict.reason === 'excluded' && verdict.rule
                ? `matches "Never show on" rule: ${describeRule(verdict.rule)}.`
                : verdict.reason === 'included' && verdict.rule
                  ? `matches ${describeRule(verdict.rule)}.`
                  : verdict.reason === 'all_pages'
                    ? 'shown on all pages and no exclusion matches.'
                    : 'no "Show on" rule matches this page.'}
            </span>
          </p>
        )}
      </div>
    </fieldset>
  );
}
