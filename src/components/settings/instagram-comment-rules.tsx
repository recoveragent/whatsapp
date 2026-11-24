'use client';
import { useCallback, useEffect, useState } from 'react';

type Connection = { id: string; username: string };
type RuleFields = { media_id: string | null; keywords: string[]; exclude_keywords: string[]; match_mode: 'word' | 'contains'; skip_mentions: boolean; public_replies: string[]; public_reply_limit: number; reply_text: string };
type Rule = RuleFields & { id: string; connection_id: string; active_since: string | null; last_checked_at: string | null; last_error: string | null };
type Reply = { id: string; commenter_username: string | null; status: 'sending' | 'sent' | 'failed' | 'unknown'; error: string | null; public_status: 'sent' | 'failed' | 'unknown' | null; public_error: string | null; created_at: string };
type Pause = { id: string; comments_paused_until: string | null; comments_pause_reason: string | null; public_replies_paused_until: string | null };
type Media = { id: string; caption?: string; media_type?: string; timestamp?: string };
type Form = { id: string | null; mediaId: string; keywords: string; exclude: string; mode: 'word' | 'contains'; skipMentions: boolean; publicReplies: string; limit: string; text: string };

const EMPTY: Form = { id: null, mediaId: '', keywords: '', exclude: '', mode: 'word', skipMentions: true, publicReplies: '', limit: '100', text: '' };
const STATUS = { sending: 'Sending', sent: 'Sent', failed: 'Failed', unknown: 'Not confirmed' } as const;
const mediaLabel = (m: Media) => `${m.caption?.replace(/\s+/g, ' ').slice(0, 60) || m.media_type || 'Post'}${m.timestamp ? ` (${m.timestamp.slice(0, 10)})` : ''}`;
const split = (value: string, by: string) => value.split(by).map((v) => v.trim()).filter(Boolean);
const inFuture = (value: string | null): value is string => value !== null && Date.parse(value) > Date.now();

async function call(method: string, body?: unknown, query = '') {
  const response = await fetch(`/api/instagram/comment-rules${query}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data;
}

export function InstagramCommentRules({ connections }: { connections: Connection[] }) {
  const connectionId = connections[0]?.id ?? '';
  const [rules, setRules] = useState<Rule[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [pauses, setPauses] = useState<Pause[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (values: Partial<Form>) => setForm((current) => ({ ...current, ...values }));

  const load = useCallback(async () => {
    const data = await call('GET');
    setRules(data.rules);
    setReplies(data.replies);
    setPauses(data.pauses);
  }, []);
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!connectionId) return;
    let stale = false;
    call('GET', undefined, `?media=${connectionId}`).then((d) => { if (!stale) setMedia(d.media); }).catch((e: Error) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [connectionId]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await load(); return true; } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); return false; } finally { setBusy(false); }
  };
  const save = async () => {
    const fields: RuleFields = { media_id: form.mediaId || null, keywords: split(form.keywords, ','), exclude_keywords: split(form.exclude, ','), match_mode: form.mode, skip_mentions: form.skipMentions, public_replies: split(form.publicReplies, '\n'), public_reply_limit: Number(form.limit), reply_text: form.text };
    const editing = rules.find((r) => r.id === form.id);
    if (editing?.active_since && !window.confirm('This rule is on. Your changes apply to new comments straight away. Save them?')) return;
    if (await run(() => (form.id ? call('PUT', { id: form.id, ...fields }) : call('POST', { connection_id: connectionId, ...fields })))) setForm(EMPTY);
  };
  const edit = (rule: Rule) => setForm({ id: rule.id, mediaId: rule.media_id ?? '', keywords: rule.keywords.join(', '), exclude: rule.exclude_keywords.join(', '), mode: rule.match_mode, skipMentions: rule.skip_mentions, publicReplies: rule.public_replies.join('\n'), limit: String(rule.public_reply_limit), text: rule.reply_text });
  const describe = (rule: Rule) => {
    const found = media.find((m) => m.id === rule.media_id);
    const post = rule.media_id === null ? 'your 10 most recent posts' : found ? `"${mediaLabel(found)}"` : `post ${rule.media_id}`;
    return `${rule.keywords.length ? `Comments containing ${rule.keywords.join(', ')}` : 'Any comment'} on ${post}`;
  };
  const toggle = (rule: Rule) => {
    const publicNote = rule.public_replies.length ? `\n\nA public reply is also posted, up to ${rule.public_reply_limit} per post.` : '';
    if (!rule.active_since && !window.confirm(`Turn on this rule?\n\n${describe(rule)} will get this DM:\n\n${rule.reply_text}${publicNote}\n\nOnly new comments are included.`)) return;
    void run(() => call('PATCH', { id: rule.id, active: !rule.active_since }));
  };
  const remove = (rule: Rule) => {
    if (!window.confirm('Delete this rule? Messages already sent are not affected.')) return;
    if (form.id === rule.id) setForm(EMPTY);
    void run(() => call('DELETE', { id: rule.id }));
  };
  const resume = (pause: Pause) => {
    if (window.confirm('Resume now? If Instagram limited this account, sending again too soon can extend the limit. Comments made during the pause will not be answered.')) void run(() => call('PATCH', { resume_connection_id: pause.id }));
  };
  const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm';
  const button = 'rounded-md border px-3 py-1 disabled:opacity-50';
  const missingMedia = form.mediaId !== '' && !media.some((m) => m.id === form.mediaId);

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-lg font-semibold">Comment to DM</h2>
        <p className="text-sm text-muted-foreground">Send one direct message to people who comment on your posts. Each person gets at most one message per post. You can only message them again if they reply.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {pauses.map((pause) => (inFuture(pause.comments_paused_until) || inFuture(pause.public_replies_paused_until)) && (
        <div key={pause.id} role="status" className="space-y-2 rounded-md border border-destructive p-4 text-sm">
          {inFuture(pause.comments_paused_until)
            ? <p>Comment to DM is paused until {new Date(pause.comments_paused_until).toLocaleString()}. {pause.comments_pause_reason} Comments made during the pause are not answered.</p>
            : <p>Public replies are paused until {new Date(pause.public_replies_paused_until!).toLocaleString()}. DMs are still being sent.</p>}
          <button type="button" disabled={busy} onClick={() => resume(pause)} className={button}>Resume now</button>
        </div>
      ))}
      {rules.map((rule) => (
        <div key={rule.id} className="space-y-2 rounded-md border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{describe(rule)}</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => toggle(rule)} className={button}>{rule.active_since ? 'Turn off' : 'Turn on'}</button>
              <button type="button" disabled={busy} onClick={() => edit(rule)} className={button}>Edit</button>
              <button type="button" disabled={busy} onClick={() => remove(rule)} className={button}>Delete</button>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-muted-foreground">{rule.reply_text}</p>
          {rule.exclude_keywords.length > 0 && <p>Never replies to: {rule.exclude_keywords.join(', ')}</p>}
          {rule.public_replies.length > 0 && <p>Public replies: {rule.public_replies.length}, up to {rule.public_reply_limit} per post</p>}
          <p>{rule.active_since ? `On${rule.last_checked_at ? `, last checked ${new Date(rule.last_checked_at).toLocaleTimeString()}` : ''}` : 'Off'}</p>
          {rule.last_error && <p className="text-destructive">Meta reported: {rule.last_error}</p>}
        </div>
      ))}
      {connectionId ? (
        <div className="space-y-3 rounded-md border p-4 text-sm">
          <h3 className="font-medium">{form.id ? 'Edit rule' : 'New rule'}</h3>
          <label className="block space-y-1"><span>Post</span>
            <select className={field} value={form.mediaId} onChange={(e) => set({ mediaId: e.target.value })}>
              <option value="">My 10 most recent posts</option>
              {missingMedia && <option value={form.mediaId}>Post {form.mediaId}</option>}
              {media.map((m) => <option key={m.id} value={m.id}>{mediaLabel(m)}</option>)}
            </select>
          </label>
          <label className="block space-y-1"><span>Keywords, separated by commas (leave empty for any comment)</span>
            <input className={field} value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="price, link" />
          </label>
          <label className="block space-y-1"><span>Never reply to comments containing</span>
            <input className={field} value={form.exclude} onChange={(e) => set({ exclude: e.target.value })} placeholder="refund, complaint" />
          </label>
          <label className="block space-y-1"><span>Match keywords</span>
            <select className={field} value={form.mode} onChange={(e) => set({ mode: e.target.value as Form['mode'] })}>
              <option value="word">As whole words (price does not match priceless)</option>
              <option value="contains">Anywhere in the comment (plz also matches plzz)</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.skipMentions} onChange={(e) => set({ skipMentions: e.target.checked })} /><span>Skip comments that tag someone else</span></label>
          <label className="block space-y-1"><span>Message to send</span>
            <textarea className={field} rows={4} value={form.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <label className="block space-y-1"><span>Public replies, one per line (optional). One is picked at random after the DM is sent. Vary the wording so Instagram does not treat it as spam.</span>
            <textarea className={field} rows={3} value={form.publicReplies} onChange={(e) => set({ publicReplies: e.target.value })} />
          </label>
          <label className="block space-y-1"><span>Stop public replies after this many per post</span>
            <input className={field} type="number" min={1} max={1000} value={form.limit} onChange={(e) => set({ limit: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={busy || !form.text.trim()} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{form.id ? 'Save changes' : 'Save rule (off)'}</button>
            {form.id && <button type="button" onClick={() => setForm(EMPTY)} disabled={busy} className={button}>Cancel</button>}
          </div>
        </div>
      ) : <p className="text-sm text-muted-foreground">Connect Instagram to add a rule.</p>}
      {replies.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="font-medium">Recent messages</h3>
          {replies.map((r) => <p key={r.id}>{new Date(r.created_at).toLocaleString()} {r.commenter_username ?? 'Instagram user'}: {STATUS[r.status]}{r.error ? ` (${r.error})` : ''}{r.public_status ? `, public reply: ${STATUS[r.public_status]}${r.public_error ? ` (${r.public_error})` : ''}` : ''}</p>)}
        </div>
      )}
    </section>
  );
}
