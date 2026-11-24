export type Connection = { id: string; username: string; token_expires_at: string | null; token_error: string | null };
export type Delivery = 'text' | 'products' | 'tap';
export type MatchMode = 'word' | 'contains';
export type Product = { id: number; title: string; image: string | null; price: string | null };
export type Media = { id: string; caption?: string; media_type?: string; timestamp?: string; media_url?: string; thumbnail_url?: string; permalink?: string };
export type Step = 'sending' | 'sent' | 'failed' | 'unknown' | 'skipped';
export type Stats = { rule_id: string; sent: number; tapped: number; clicked: number; reminded: number };
export type Pause = { id: string; comments_paused_until: string | null; comments_pause_reason: string | null; public_replies_paused_until: string | null };

export type RuleFields = {
  media_id: string | null; keywords: string[]; exclude_keywords: string[]; match_mode: MatchMode; skip_mentions: boolean;
  public_replies: string[]; public_reply_limit: number; reply_text: string; delivery: Delivery; product_ids: number[];
  tap_title: string; tap_subtitle: string; tap_button: string; reminder_text: string | null; reminder_minutes: number;
};
export type Rule = RuleFields & { id: string; connection_id: string; active_since: string | null; last_checked_at: string | null; last_error: string | null };
export type Reply = {
  id: string; rule_id: string | null; commenter_username: string | null; status: Exclude<Step, 'skipped'>; error: string | null;
  public_status: 'sent' | 'failed' | 'unknown' | null; public_error: string | null; delivery: Delivery; tapped_at: string | null;
  products_status: Step | null; products_error: string | null; reminder_status: Step | null; reminder_error: string | null; created_at: string;
};

export const mediaImage = (m: Media | undefined) => m?.thumbnail_url ?? (m?.media_type === 'VIDEO' ? undefined : m?.media_url);
export const mediaTitle = (m: Media) => m.caption?.replace(/\s+/g, ' ').trim() || 'Post without a caption';
export const mediaDate = (m: Media) => (m.timestamp ? new Date(m.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function timeAgo(value: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(value)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export async function callRules(method: string, body?: unknown, query = '') {
  const response = await fetch(`/api/instagram/comment-rules${query}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data;
}
