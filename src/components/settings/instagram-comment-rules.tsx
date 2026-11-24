'use client';
import { useCallback, useEffect, useState } from 'react';

type Connection = { id: string; username: string };
type Rule = { id: string; connection_id: string; media_id: string | null; keywords: string[]; reply_text: string; active_since: string | null; last_checked_at: string | null; last_error: string | null };
type Reply = { id: string; commenter_username: string | null; status: 'sending' | 'sent' | 'failed' | 'unknown'; error: string | null; created_at: string };
type Media = { id: string; caption?: string; media_type?: string; timestamp?: string };

const STATUS: Record<Reply['status'], string> = { sending: 'Sending', sent: 'Sent', failed: 'Failed', unknown: 'Not confirmed' };
const mediaLabel = (m: Media) => `${m.caption?.replace(/\s+/g, ' ').slice(0, 60) || m.media_type || 'Post'}${m.timestamp ? ` (${m.timestamp.slice(0, 10)})` : ''}`;

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
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaId, setMediaId] = useState('');
  const [keywords, setKeywords] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const data = await call('GET');
    setRules(data.rules);
    setReplies(data.replies);
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
  const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);
  const add = async () => {
    if (await run(() => call('POST', { connection_id: connectionId, media_id: mediaId || null, keywords: keywordList, reply_text: text }))) { setKeywords(''); setText(''); setMediaId(''); }
  };
  const describe = (rule: Rule) => {
    const post = rule.media_id === null ? 'your 10 most recent posts' : media.find((m) => m.id === rule.media_id) ? `"${mediaLabel(media.find((m) => m.id === rule.media_id)!)}"` : `post ${rule.media_id}`;
    return `${rule.keywords.length ? `Comments containing ${rule.keywords.join(', ')}` : 'Any comment'} on ${post}`;
  };
  const toggle = (rule: Rule) => {
    if (!rule.active_since && !window.confirm(`Turn on this rule?\n\n${describe(rule)} will get this DM:\n\n${rule.reply_text}\n\nOnly new comments are included.`)) return;
    void run(() => call('PATCH', { id: rule.id, active: !rule.active_since }));
  };
  const remove = (rule: Rule) => {
    if (window.confirm('Delete this rule? Messages already sent are not affected.')) void run(() => call('DELETE', { id: rule.id }));
  };
  const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-lg font-semibold">Comment to DM</h2>
        <p className="text-sm text-muted-foreground">Send one direct message to people who comment on your posts. Each person gets at most one message per post. You can only message them again if they reply.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rules.map((rule) => (
        <div key={rule.id} className="space-y-2 rounded-md border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{describe(rule)}</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => toggle(rule)} className="rounded-md border px-3 py-1 disabled:opacity-50">{rule.active_since ? 'Turn off' : 'Turn on'}</button>
              <button type="button" disabled={busy} onClick={() => remove(rule)} className="rounded-md border px-3 py-1 disabled:opacity-50">Delete</button>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-muted-foreground">{rule.reply_text}</p>
          <p>{rule.active_since ? `On${rule.last_checked_at ? `, last checked ${new Date(rule.last_checked_at).toLocaleTimeString()}` : ''}` : 'Off'}</p>
          {rule.last_error && <p className="text-destructive">Meta reported: {rule.last_error}</p>}
        </div>
      ))}
      {connectionId ? (
        <div className="space-y-3 rounded-md border p-4">
          <label className="block space-y-1 text-sm"><span>Post</span>
            <select className={field} value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
              <option value="">My 10 most recent posts</option>
              {media.map((m) => <option key={m.id} value={m.id}>{mediaLabel(m)}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm"><span>Keywords, separated by commas (leave empty for any comment)</span>
            <input className={field} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="price, link" />
          </label>
          <label className="block space-y-1 text-sm"><span>Message to send</span>
            <textarea className={field} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="button" onClick={() => void add()} disabled={busy || !text.trim()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Save rule (off)</button>
        </div>
      ) : <p className="text-sm text-muted-foreground">Connect Instagram to add a rule.</p>}
      {replies.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="font-medium">Recent messages</h3>
          {replies.map((r) => <p key={r.id}>{new Date(r.created_at).toLocaleString()} {r.commenter_username ?? 'Instagram user'}: {STATUS[r.status]}{r.error ? ` (${r.error})` : ''}</p>)}
        </div>
      )}
    </section>
  );
}
