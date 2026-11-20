'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Thread = { id: string; participant_id: string; last_message_text: string; last_message_at: string; last_inbound_at: string | null };
type Message = { id: string; direction: 'inbound' | 'outbound'; content: string; created_at: string };
export function InstagramChannel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const list = await fetch('/api/instagram', { cache: 'no-store' });
      if (!list.ok) throw new Error('Could not load Instagram conversations.');
      const data = await list.json();
      const response = selected ? await fetch(`/api/instagram?thread=${encodeURIComponent(selected)}`, { cache: 'no-store' }) : null;
      if (response && !response.ok) throw new Error('Could not load messages.');
      const thread = response ? await response.json() : null;
      if (version !== requestVersion.current) return;
      setThreads(data.threads); setConnected(data.connections.length > 0); setMessages(thread?.messages ?? []);
    } catch (e) { if (version === requestVersion.current) setError(e instanceof Error ? e.message : 'Could not load messages.'); }
  }, [selected]);
  useEffect(() => { const version = requestVersion; void load(); const timer = window.setInterval(() => void load(), 10000); return () => { version.current++; window.clearInterval(timer); }; }, [load]);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true); setError('');
    try { const r = await fetch('/api/instagram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread_id: selected, text }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setText(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send message.'); }
    finally { setSending(false); }
  };
  return <div className="flex min-h-0 flex-1 overflow-hidden"><div className="w-48 shrink-0 overflow-y-auto border-r sm:w-80"><div className="border-b p-3 font-semibold">Instagram messages</div>{threads.length === 0 && connected !== null && <p className="p-3 text-sm text-muted-foreground">{connected ? "No new messages yet. Existing Instagram conversations are not imported." : <>No messages yet. <a className="underline" href="/settings?tab=instagram">Connect Instagram</a></>}</p>}{threads.map(t => <button key={t.id} onClick={() => { setMessages([]); setSelected(t.id); }} className={`block w-full border-b p-3 text-left text-sm ${selected === t.id ? 'bg-muted' : ''}`}><span className="block">Instagram user {t.participant_id}</span><span className="block truncate text-muted-foreground">{t.last_message_text}</span></button>)}</div><div className="flex min-w-0 flex-1 flex-col">{error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}{selected ? <><div className="flex-1 space-y-3 overflow-y-auto p-4">{messages.map(m => <div key={m.id} className={`max-w-[85%] rounded-lg p-3 text-sm whitespace-pre-wrap ${m.direction === 'outbound' ? 'ml-auto bg-primary/10' : 'bg-muted'}`}>{m.content}</div>)}</div><div className="flex gap-2 border-t p-3"><input aria-label="Instagram message" className="min-w-0 flex-1 rounded-md border bg-background px-3" value={text} maxLength={1000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send(); }} /><button onClick={() => void send()} disabled={sending || !text.trim()} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">Send</button></div></> : <p className="p-4 text-sm text-muted-foreground">Select a conversation.</p>}</div></div>;
}
