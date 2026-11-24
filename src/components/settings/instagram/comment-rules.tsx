'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangleIcon, EllipsisVerticalIcon, LayoutGridIcon, LoaderCircleIcon, MessageCircleIcon, MousePointerClickIcon, PencilIcon, PlusIcon, ShoppingBagIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { SettingsChip, type ChipVariant } from '../settings-chip';
import { ConfirmDialog, type Confirm } from './confirm-dialog';
import { Thumb } from './fields';
import { RuleEditor } from './rule-editor';
import { callRules, mediaDate, mediaImage, mediaTitle, timeAgo, type Connection, type Media, type Pause, type Product, type Reply, type Rule, type Stats, type Step } from './types';

const inFuture = (value: string | null): value is string => value !== null && Date.parse(value) > Date.now();
const DELIVERY = {
  text: { label: 'Text message', icon: MessageCircleIcon },
  products: { label: 'Product cards', icon: ShoppingBagIcon },
  tap: { label: 'Button, then products', icon: MousePointerClickIcon },
} as const;
const STEP: Record<Step, { label: string; tone: ChipVariant }> = {
  sending: { label: 'sending', tone: 'muted' }, sent: { label: 'sent', tone: 'ok' }, failed: { label: 'failed', tone: 'warn' },
  unknown: { label: 'not confirmed', tone: 'warn' }, skipped: { label: 'skipped', tone: 'muted' },
};

function Keywords({ rule }: { rule: Rule }) {
  if (rule.keywords.length === 0) return <SettingsChip variant="warn">Every comment</SettingsChip>;
  return <>{rule.keywords.slice(0, 5).map((k) => <SettingsChip key={k} className="bg-card">{k}</SettingsChip>)}{rule.keywords.length > 5 && <SettingsChip className="bg-card">+{rule.keywords.length - 5}</SettingsChip>}</>;
}

function Numbers({ rule, stats }: { rule: Rule; stats?: Stats }) {
  const items: [string, number][] = [['Sent', stats?.sent ?? 0]];
  if (rule.delivery === 'tap') items.push(['Tapped', stats?.tapped ?? 0]);
  if (rule.delivery !== 'text') items.push(['Opened', stats?.clicked ?? 0]);
  if (rule.reminder_text) items.push(['Reminded', stats?.reminded ?? 0]);
  return <dl className="flex gap-5">{items.map(([label, value]) => <div key={label} className="flex flex-col-reverse text-center"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-base leading-tight font-semibold tabular-nums">{value}</dd></div>)}</dl>;
}

function ActivityRow({ reply }: { reply: Reply }) {
  const steps: [string, Step, string | null][] = [['DM', reply.status, reply.error]];
  if (reply.public_status) steps.push(['Public reply', reply.public_status, reply.public_error]);
  if (reply.products_status) steps.push(['Products', reply.products_status, reply.products_error]);
  if (reply.reminder_status) steps.push(['Reminder', reply.reminder_status, reply.reminder_error]);
  const problem = steps.find(([, , detail]) => detail);
  const name = reply.commenter_username ?? 'Instagram user';
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-muted-foreground uppercase">{name.charAt(0)}</span>
        <div className="min-w-0"><p className="truncate text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{timeAgo(reply.created_at)}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        {steps.map(([label, step]) => <SettingsChip key={label} variant={STEP[step].tone}>{label} {STEP[step].label}</SettingsChip>)}
        {reply.delivery === 'tap' && !reply.products_status && <SettingsChip>{reply.tapped_at ? 'Tapped' : 'Waiting for tap'}</SettingsChip>}
        {problem && <p className="w-full text-xs text-muted-foreground sm:text-right">{problem[0]}: {problem[2]}</p>}
      </div>
    </li>
  );
}

export function InstagramCommentRules({ connections }: { connections: Connection[] }) {
  const connectionId = connections[0]?.id ?? '';
  const [loaded, setLoaded] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [pauses, setPauses] = useState<Pause[]>([]);
  const [stats, setStats] = useState<Stats[]>([]);
  const [known, setKnown] = useState<Product[]>([]);
  const [media, setMedia] = useState<Media[] | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [switching, setSwitching] = useState('');

  const load = useCallback(async () => {
    const data = await callRules('GET');
    setRules(data.rules); setReplies(data.replies); setPauses(data.pauses); setStats(data.stats); setKnown(data.products); setLoaded(true); setError('');
  }, []);
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!connectionId) return;
    let stale = false;
    callRules('GET', undefined, `?media=${connectionId}`).then((d) => { if (!stale) { setMedia(d.media); setMediaError(''); } }).catch((e: Error) => { if (!stale) setMediaError(e.message); });
    return () => { stale = true; };
  }, [connectionId]);

  const toggle = async (rule: Rule, active: boolean) => { await callRules('PATCH', { id: rule.id, active }); await load(); };
  const onSwitch = async (rule: Rule, active: boolean) => {
    if (active) {
      setConfirm({
        title: 'Turn on this rule?', action: 'Turn on', run: () => toggle(rule, true),
        body: (
          <>
            <p>{rule.keywords.length ? `New comments containing ${rule.keywords.join(', ')}` : 'Every new comment'} will get {rule.delivery === 'text' ? 'this DM' : `${DELIVERY[rule.delivery].label.toLowerCase()}. The backup text is`}:</p>
            <p className="rounded-2xl bg-accent p-3 break-words whitespace-pre-wrap text-foreground">{rule.reply_text}</p>
            {rule.public_replies.length > 0 && <p>A public reply is also posted, up to {rule.public_reply_limit} per post.</p>}
            <p>Comments made before now are not answered.</p>
          </>
        ),
      });
      return;
    }
    setSwitching(rule.id); setError('');
    try { await toggle(rule, false); } catch (e) { setError(e instanceof Error ? e.message : 'Could not turn off the rule.'); } finally { setSwitching(''); }
  };
  const remove = (rule: Rule) => setConfirm({ title: 'Delete this rule?', action: 'Delete', destructive: true, body: <p>Messages already sent are not affected. Results for this rule will no longer be shown.</p>, run: async () => { await callRules('DELETE', { id: rule.id }); await load(); } });
  const resume = (pause: Pause) => setConfirm({ title: 'Resume now?', action: 'Resume', body: <p>If Instagram limited this account, sending again too soon can extend the limit. Comments made during the pause are not answered.</p>, run: async () => { await callRules('PATCH', { resume_connection_id: pause.id }); await load(); } });
  const shown = showAll ? replies : replies.slice(0, 5);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-cabinet text-lg font-bold tracking-tight">Comment to DM</h2>
          <p className="text-sm text-muted-foreground">Turn comments into conversations. One DM per person, per post.</p>
        </div>
        {connectionId && rules.length > 0 && <Button onClick={() => setEditing('new')} className="self-start"><PlusIcon />New rule</Button>}
      </div>
      {error && <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
      {pauses.map((pause) => (inFuture(pause.comments_paused_until) || inFuture(pause.public_replies_paused_until)) && (
        <div key={pause.id} role="status" className="flex flex-col gap-3 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700"><AlertTriangleIcon className="size-5" /></span>
          <div className="min-w-0 flex-1 text-sm">
            {inFuture(pause.comments_paused_until)
              ? <><p className="font-semibold">Paused until {new Date(pause.comments_paused_until).toLocaleString()}</p><p className="text-muted-foreground">{pause.comments_pause_reason} Comments made during the pause are not answered.</p></>
              : <><p className="font-semibold">Public replies paused until {new Date(pause.public_replies_paused_until!).toLocaleString()}</p><p className="text-muted-foreground">DMs are still being sent.</p></>}
          </div>
          <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => resume(pause)}>Resume now</Button>
        </div>
      ))}

      <Card className="gap-3 p-3 sm:p-4">
        {!loaded && !error && <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />Loading rules</p>}
        {!loaded && error && <p className="py-8 text-center text-sm text-muted-foreground">Rules could not be loaded.</p>}
        {loaded && rules.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><MessageCircleIcon className="size-6" /></span>
            <div><p className="font-semibold">No rules yet</p><p className="text-sm text-muted-foreground">{connectionId ? 'Choose a post, pick keywords and write the DM.' : 'Connect Instagram to add your first rule.'}</p></div>
            {connectionId && <Button onClick={() => setEditing('new')}><PlusIcon />Create a rule</Button>}
          </div>
        )}
        {rules.map((rule) => {
          const post = media?.find((m) => m.id === rule.media_id);
          const title = rule.media_id === null ? 'My 10 most recent posts' : post ? mediaTitle(post) : 'Earlier post';
          const Icon = DELIVERY[rule.delivery].icon;
          const on = rule.active_since !== null;
          return (
            <article key={rule.id} className="rounded-2xl bg-accent/60 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                {rule.media_id === null ? <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><LayoutGridIcon className="size-5" /></span> : <Thumb src={mediaImage(post)} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={title}>{title}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Icon className="size-3.5" />{DELIVERY[rule.delivery].label}</span>
                    {post && <span>{mediaDate(post)}</span>}
                    {rule.public_replies.length > 0 && <span>+ public reply</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch checked={on} disabled={switching === rule.id} onCheckedChange={(checked) => void onSwitch(rule, checked)} aria-label={`${on ? 'Turn off' : 'Turn on'} rule for ${title}`} className={cn(!on && 'data-[unchecked]:bg-input')} />
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${title}`} />}><EllipsisVerticalIcon /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem onClick={() => setEditing(rule)}><PencilIcon />Edit</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => remove(rule)}><Trash2Icon />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap gap-1.5"><Keywords rule={rule} />{rule.exclude_keywords.length > 0 && <SettingsChip variant="warn">{rule.exclude_keywords.length} blocked</SettingsChip>}</div>
                <Numbers rule={rule} stats={stats.find((s) => s.rule_id === rule.id)} />
              </div>
              <p className={cn('mt-2 text-xs', rule.last_error ? 'text-destructive' : 'text-muted-foreground')}>
                {rule.last_error ? `Instagram reported: ${rule.last_error}` : on ? (rule.last_checked_at ? `On. Checked ${timeAgo(rule.last_checked_at)}` : 'On. First check is due within a minute') : 'Off'}
              </p>
            </article>
          );
        })}
      </Card>

      {replies.length > 0 && (
        <Card className="gap-0 py-0">
          <h3 className="border-b border-border px-5 py-4 text-base font-semibold">Recent activity</h3>
          <ul className="divide-y divide-border">{shown.map((r) => <ActivityRow key={r.id} reply={r} />)}</ul>
          {replies.length > 5 && <button type="button" onClick={() => setShowAll(!showAll)} className="w-full border-t border-border py-3 text-sm font-medium text-primary hover:bg-accent">{showAll ? 'Show less' : `Show all ${replies.length}`}</button>}
        </Card>
      )}

      {editing && <RuleEditor key={editing === 'new' ? 'new' : editing.id} rule={editing === 'new' ? null : editing} connectionId={connectionId} media={media} mediaError={mediaError} known={known} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load().catch((e: Error) => setError(e.message)); }} />}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
