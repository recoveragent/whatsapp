'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CONDITION_ITEM_KEY_LABELS,
  CONDITION_ITEM_KEYS,
  CONDITION_OPERATOR_LABELS,
  CONDITION_OPERATORS,
  isShopifySubject,
  operatorsForConditionField,
  operatorsForField,
  PAYMENT_STATUSES,
  shopifyConditionFields,
} from '@/lib/flows/conditions';
import type {
  ConditionNodeConfig,
  ConditionPredicate,
  ConditionSubject,
} from '@/lib/flows/types';
import { DEFAULT_COD_GATEWAYS } from '@/lib/shopify/condition-data';
import type { FormConditionSource } from '@/lib/flows/form-variables';

type Draft = Partial<ConditionNodeConfig>;
type Choice = { value: string; label: string };
function Picker({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground block text-xs">
        {label}
      </label>
      <Select
        value={value}
        items={choices}
        onValueChange={(v) => {
          if (v) onChange(v);
        }}
      >
        <SelectTrigger id={id} className="bg-muted">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
const choices = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value.replaceAll('_', ' ') }));

/** The form whose answers a `var` path like `form.plan` points at. */
function formForPath(forms: FormConditionSource[], path: string | undefined) {
  if (!path) return undefined;
  return forms
    .filter((f) => path === f.var_key || path.startsWith(`${f.var_key}.`))
    .sort((a, b) => b.var_key.length - a.var_key.length)[0];
}

function CollectionSuggestions({
  selected,
  onChoose,
}: {
  selected: string[];
  onChoose: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [collections, setCollections] = useState<
    Array<{ id: string | number; title: string }>
  >([]);
  const [status, setStatus] = useState('Loading collections…');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/shopify/collections', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok)
          throw new Error('Collections unavailable. Enter the ID above.');
        return res.json();
      })
      .then((data) => {
        const list = Array.isArray(data.collections) ? data.collections : [];
        setCollections(list);
        setStatus(list.length ? '' : 'No collections found in Shopify.');
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setStatus(
            err instanceof Error
              ? err.message
              : 'Collections unavailable. Enter the ID above.'
          );
      });
    return () => controller.abort();
  }, []);
  const q = query.trim().toLowerCase();
  const options = collections.filter((c) => c.title.toLowerCase().includes(q));
  const titleOf = (id: string) =>
    collections.find((c) => String(c.id) === id)?.title;
  return (
    <div className="space-y-2 rounded-md border p-2">
      {selected.length > 0 && (
        <p className="text-xs">
          Selected:{' '}
          {selected.map((id) => titleOf(id) ?? `#${id}`).join(', ')}
        </p>
      )}
      <Input
        aria-label="Search Shopify collections"
        placeholder="Find collection…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {status && <p className="text-muted-foreground text-xs">{status}</p>}
      <div className="max-h-36 overflow-y-auto">
        {options.map((c) => (
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start text-left text-xs whitespace-normal"
            key={String(c.id)}
            onClick={() => onChoose(String(c.id))}
          >
            {c.title}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Adds to comma lists for multi-value operators, otherwise replaces. */
function chosenValue(current: string | undefined, id: string, multi: boolean) {
  if (!multi) return id;
  return [
    ...new Set([
      ...(current ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      id,
    ]),
  ].join(', ');
}

function CatalogSuggestions({
  kind,
  onChoose,
}: {
  kind: 'product_id' | 'variant_id' | 'title';
  onChoose: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<
    Array<{
      shopify_product_id: string | number;
      shopify_variant_id: string | number;
      title: string;
      variant_title?: string | null;
    }>
  >([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus('Searching catalog…');
      void fetch(
        `/api/shopify/products?${new URLSearchParams({ q: query, limit: '25', in_stock_only: 'false' })}`,
        { signal: controller.signal, cache: 'no-store' }
      )
        .then(async (res) => {
          if (!res.ok)
            throw new Error('Catalog unavailable. Enter the ID above.');
          return res.json();
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setProducts(Array.isArray(data.products) ? data.products : []);
          setStatus(
            data.products?.length
              ? ''
              : 'No catalog matches. You can enter an ID above.'
          );
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            setProducts([]);
            setStatus(
              err instanceof Error
                ? err.message
                : 'Catalog unavailable. Enter an ID above.'
            );
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const seen = new Set<string>();
  const valueOf = (p: (typeof products)[number]) =>
    kind === 'title'
      ? p.title
      : String(
          kind === 'product_id' ? p.shopify_product_id : p.shopify_variant_id
        );
  const options = products.filter((p) => {
    const id = valueOf(p);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return (
    <div className="space-y-2 rounded-md border p-2">
      <Input
        aria-label="Search Shopify catalog"
        placeholder="Find product in catalog…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {status && <p className="text-muted-foreground text-xs">{status}</p>}
      <div className="max-h-36 overflow-y-auto">
        {options.map((p) => {
          const id = valueOf(p);
          return (
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start text-left text-xs whitespace-normal"
              key={id}
              onClick={() => onChoose(id)}
            >
              {p.title}
              {kind === 'variant_id' &&
              p.variant_title &&
              p.variant_title !== 'Default Title'
                ? ` · ${p.variant_title}`
                : ''}
              {kind === 'title' ? '' : ` (${id})`}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function PredicateFields({
  cfg,
  onPatch,
  triggerType,
  tags,
  varKeys,
  forms = [],
}: {
  cfg: Draft;
  onPatch: (patch: Draft) => void;
  triggerType?: string;
  tags: { id: string; name: string }[];
  varKeys: string[];
  forms?: FormConditionSource[];
}) {
  const variableListId = useId();
  const subject = cfg.subject ?? 'var';
  const form = subject === 'var' ? formForPath(forms, cfg.subject_key) : undefined;
  const formKey = form ? (cfg.subject_key ?? '').slice(form.var_key.length + 1) : '';
  const formField = form?.fields.find((f) => f.key === formKey);
  const shopify = isShopifySubject(subject);
  const fields = shopifyConditionFields(subject);
  const field = shopify
    ? fields.find((f) => f.key === cfg.subject_key)
    : undefined;
  const operator = cfg.operator ?? 'equals';
  const allowed =
    subject === 'tag'
      ? (['present', 'absent'] as const)
      : subject === 'shopify_payment'
        ? operatorsForField('enum')
        : field
          ? operatorsForConditionField(field)
          : CONDITION_OPERATORS;
  const multiValue = ['contains_any', 'contains_all'].includes(operator);
  const subjectChoices: Choice[] = [
    { value: 'var', label: 'Captured / custom variable' },
    { value: 'tag', label: 'Contact tag' },
    { value: 'contact_field', label: 'Contact field' },
  ];
  subjectChoices.unshift(
    ...forms.map((f) => ({
      value: `form:${f.node_key}`,
      label: `Form answer · ${f.name}`,
    }))
  );
  if (triggerType?.startsWith('shopify_'))
    subjectChoices.unshift({
      value: triggerType.includes('checkout')
        ? 'shopify_checkout'
        : 'shopify_order',
      label: triggerType.includes('checkout')
        ? 'Triggering Shopify checkout'
        : 'Triggering Shopify order',
    });
  if (!subjectChoices.some((c) => c.value === subject))
    subjectChoices.push({
      value: subject,
      label:
        subject === 'shopify_payment'
          ? 'Shopify payment status (legacy)'
          : subject.replaceAll('_', ' '),
    });
  const keyChoices = form
    ? form.fields.map((f) => ({ value: f.key, label: f.label || f.key }))
    : shopify
    ? fields.map((f) => ({ value: f.key, label: f.label }))
    : subject === 'tag'
      ? tags.map((t) => ({ value: t.id, label: t.name }))
      : subject === 'contact_field'
        ? choices(['name', 'email', 'phone', 'company'])
        : [];
  const setSubject = (next: string) => {
    const picked = next.startsWith('form:')
      ? forms.find((f) => `form:${f.node_key}` === next)
      : undefined;
    if (picked) {
      const firstField = picked.fields[0];
      onPatch({
        subject: 'var',
        subject_key: `${picked.var_key}.${firstField?.key ?? ''}`,
        operator: 'equals',
        value: firstField?.options?.[0]?.id ?? '',
        value_to: undefined,
        data_source: 'snapshot',
      });
      return;
    }
    const typed = next as ConditionSubject;
    const first = isShopifySubject(next)
      ? shopifyConditionFields(next)[0]!
      : undefined;
    onPatch({
      subject: typed,
      subject_key: first?.key ?? (next === 'contact_field' ? 'name' : ''),
      operator: next === 'tag' ? 'present' : 'equals',
      value: first?.options?.[0] ?? '',
      value_to: undefined,
      data_source: 'snapshot',
    });
  };
  const statusOptions =
    subject === 'shopify_payment' ? PAYMENT_STATUSES : field?.options;
  const textOperator = ['equals', 'not_equals', 'contains', 'not_contains'].includes(operator);
  const valueChoices =
    formField?.options && textOperator
      ? formField.options.map((o) => ({ value: o.id, label: o.title }))
      : field?.type === 'boolean'
      ? choices(['true', 'false'])
      : ['equals', 'not_equals', 'contains', 'not_contains'].includes(
            operator
          ) && statusOptions
        ? choices(statusOptions)
        : undefined;
  return (
    <div className="space-y-3">
      <Picker
        label="If"
        value={form ? `form:${form.node_key}` : subject}
        choices={subjectChoices}
        onChange={setSubject}
      />
      {subject !== 'shopify_payment' &&
        (keyChoices.length ? (
          <Picker
            label={form ? 'Question' : 'Field'}
            value={form ? formKey : (cfg.subject_key ?? '')}
            choices={keyChoices}
            onChange={(key) => {
              if (form) {
                const picked = form.fields.find((f) => f.key === key);
                onPatch({
                  subject_key: `${form.var_key}.${key}`,
                  operator: 'equals',
                  value: picked?.options?.[0]?.id ?? '',
                  value_to: undefined,
                });
                return;
              }
              const next = fields.find((f) => f.key === key);
              const op = next
                ? operatorsForConditionField(next)[0]!
                : subject === 'tag'
                  ? 'present'
                  : 'equals';
              onPatch({
                subject_key: key,
                operator: op,
                value:
                  next?.type === 'boolean'
                    ? 'true'
                    : (next?.options?.[0] ?? ''),
                value_to: undefined,
              });
            }}
          />
        ) : (
          <div className="space-y-1">
            <label className="text-muted-foreground block text-xs">
              {subject === 'tag' ? 'Tag ID' : 'Variable path'}
            </label>
            <Input
              value={cfg.subject_key ?? ''}
              onChange={(e) => onPatch({ subject_key: e.target.value })}
              placeholder="e.g. email or address.city"
              list={variableListId}
            />
            <datalist id={variableListId}>
              {varKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>
        ))}
      {shopify && (
        <>
          <Picker
            label="Read data from"
            value={cfg.data_source ?? 'snapshot'}
            choices={
              subject === 'shopify_checkout'
                ? [{ value: 'snapshot', label: 'Event snapshot' }]
                : [
                    { value: 'snapshot', label: 'Event snapshot' },
                    { value: 'latest', label: 'Latest state from Shopify' },
                  ]
            }
            onChange={(v) =>
              onPatch({ data_source: v as 'snapshot' | 'latest' })
            }
          />
          <p className="text-muted-foreground text-xs">
            Checks the resource that triggered this run. Customer history always
            uses Shopify’s current records. Failed lookups stop the run and
            appear in its log.
          </p>
        </>
      )}
      {field?.key === 'is_cod' && (
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs">
            COD gateway names (comma-separated, exact match, ignores case)
          </label>
          <Input
            value={cfg.cod_gateways ?? DEFAULT_COD_GATEWAYS}
            onChange={(e) => onPatch({ cod_gateways: e.target.value })}
          />
        </div>
      )}
      {field?.key === 'item_quantity' && (
        <>
          <Picker
            label="Identify item by"
            value={cfg.item_key ?? 'product_id'}
            choices={CONDITION_ITEM_KEYS.map((value) => ({
              value,
              label: CONDITION_ITEM_KEY_LABELS[value],
            }))}
            onChange={(v) =>
              onPatch({
                item_key: v as ConditionPredicate['item_key'],
                ...(v !== (cfg.item_key ?? 'product_id')
                  ? { item_value: '' }
                  : {}),
              })
            }
          />
          <Input
            aria-label="Item to count"
            placeholder={
              {
                product_id: 'Product ID',
                variant_id: 'Variant ID',
                sku: 'SKU',
                title: 'Product name (ignores case)',
                collection_id: 'Collection ID',
              }[cfg.item_key ?? 'product_id']
            }
            value={cfg.item_value ?? ''}
            onChange={(e) =>
              onPatch({
                item_value: e.target.value,
                item_key: cfg.item_key ?? 'product_id',
              })
            }
          />
        </>
      )}
      <Picker
        label="Operator"
        value={operator}
        choices={allowed.map((value) => ({
          value,
          label: CONDITION_OPERATOR_LABELS[value],
        }))}
        onChange={(v) =>
          onPatch({ operator: v as ConditionPredicate['operator'] })
        }
      />
      {!['present', 'absent'].includes(operator) &&
        (valueChoices ? (
          <Picker
            label="Value"
            value={cfg.value ?? ''}
            choices={valueChoices}
            onChange={(value) => onPatch({ value })}
          />
        ) : (
          <div className="space-y-1">
            <label className="text-muted-foreground block text-xs">
              {operator === 'between' ? 'Minimum' : 'Value'}
            </label>
            <Input
              type={
                field?.type === 'number' ||
                ['gt', 'gte', 'lt', 'lte', 'between'].includes(operator)
                  ? 'number'
                  : 'text'
              }
              step="any"
              value={cfg.value ?? ''}
              onChange={(e) => onPatch({ value: e.target.value })}
              placeholder={
                ['before', 'after'].includes(operator)
                  ? '2026-10-13T12:00:00+05:30'
                  : ['in', 'not_in', 'contains_any', 'contains_all'].includes(
                        operator
                      )
                    ? 'Comma-separated values'
                    : 'Comparison value'
              }
            />
          </div>
        ))}
      {shopify &&
        (field?.key === 'product_ids' ||
          field?.key === 'variant_ids' ||
          field?.key === 'product_names') &&
        !['present', 'absent'].includes(operator) && (
          <CatalogSuggestions
            kind={
              field.key === 'product_ids'
                ? 'product_id'
                : field.key === 'variant_ids'
                  ? 'variant_id'
                  : 'title'
            }
            onChoose={(id) =>
              onPatch({ value: chosenValue(cfg.value, id, multiValue) })
            }
          />
        )}
      {shopify && field?.key === 'collection_ids' && (
        <CollectionSuggestions
          selected={(cfg.value ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)}
          onChoose={(id) =>
            onPatch({ value: chosenValue(cfg.value, id, multiValue) })
          }
        />
      )}
      {field?.key === 'item_quantity' &&
        cfg.item_key !== 'sku' &&
        (cfg.item_key === 'collection_id' ? (
          <CollectionSuggestions
            selected={cfg.item_value ? [cfg.item_value] : []}
            onChoose={(id) =>
              onPatch({ item_key: 'collection_id', item_value: id })
            }
          />
        ) : (
          <CatalogSuggestions
            kind={
              cfg.item_key === 'variant_id'
                ? 'variant_id'
                : cfg.item_key === 'title'
                  ? 'title'
                  : 'product_id'
            }
            onChoose={(id) =>
              onPatch({
                item_key: cfg.item_key ?? 'product_id',
                item_value: id,
              })
            }
          />
        ))}
      {field?.key === 'collection_ids' && (
        <p className="text-muted-foreground text-xs">
          Matches when any product in the cart belongs to the collection.
          Checked live with Shopify when the flow runs.
        </p>
      )}
      {operator === 'between' && (
        <Input
          type="number"
          step="any"
          aria-label="Maximum"
          placeholder="Maximum (inclusive)"
          value={cfg.value_to ?? ''}
          onChange={(e) => onPatch({ value_to: e.target.value })}
        />
      )}
      {field?.type === 'number' &&
        ['total', 'discount_total'].includes(field.key) && (
          <p className="text-muted-foreground text-xs">
            Amount in the order/checkout currency. Add a currency rule when
            handling multiple currencies.
          </p>
        )}
    </div>
  );
}

export function ConditionRuleFields(props: {
  cfg: Draft;
  onPatch: (patch: Draft) => void;
  triggerType?: string;
  tags: { id: string; name: string }[];
  varKeys: string[];
  forms?: FormConditionSource[];
}) {
  const { cfg, onPatch } = props;
  if (!cfg.rules)
    return (
      <div className="space-y-3">
        <PredicateFields {...props} />
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onPatch({
              match: 'all',
              rules: [
                {
                  subject: cfg.subject ?? 'var',
                  subject_key: cfg.subject_key ?? '',
                  operator: cfg.operator ?? 'equals',
                  value: cfg.value,
                  value_to: cfg.value_to,
                  data_source: cfg.data_source,
                  cod_gateways: cfg.cod_gateways,
                  item_key: cfg.item_key,
                  item_value: cfg.item_value,
                },
              ],
            })
          }
        >
          Add ALL / ANY rules
        </Button>
      </div>
    );
  const rules = cfg.rules;
  return (
    <div className="space-y-3">
      <Picker
        label="Match"
        value={cfg.match ?? 'all'}
        choices={[
          { value: 'all', label: 'ALL rules must match (AND)' },
          { value: 'any', label: 'ANY rule can match (OR)' },
        ]}
        onChange={(v) => onPatch({ match: v as 'all' | 'any' })}
      />
      {rules.map((rule, index) => (
        <div key={index} className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Rule {index + 1}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={rules.length === 1}
              onClick={() =>
                onPatch({ rules: rules.filter((_, i) => i !== index) })
              }
            >
              Remove
            </Button>
          </div>
          <PredicateFields
            {...props}
            cfg={rule}
            onPatch={(patch) =>
              onPatch({
                rules: rules.map((r, i) =>
                  i === index ? { ...r, ...patch } : r
                ),
              })
            }
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={rules.length >= 20}
        onClick={() => {
          const subject = props.triggerType?.startsWith('shopify_')
            ? props.triggerType.includes('checkout')
              ? 'shopify_checkout'
              : 'shopify_order'
            : 'var';
          onPatch({
            rules: [
              ...rules,
              {
                subject,
                subject_key:
                  subject === 'shopify_order'
                    ? 'payment_status'
                    : subject === 'shopify_checkout'
                      ? 'total'
                      : '',
                operator: subject === 'shopify_checkout' ? 'gte' : 'equals',
                value: subject === 'shopify_order' ? 'paid' : '',
              },
            ],
          });
        }}
      >
        Add rule
      </Button>
    </div>
  );
}
