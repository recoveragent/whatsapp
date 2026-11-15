'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Chat = { id: string; last_message_at: string; last_message_text: string };
type Turn = { id: string; role: 'user' | 'assistant'; content: string; created_at: string };

export function WebsiteChatChannel() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const [list, thread] = await Promise.all([
        fetch(`/api/inbox/website-chats?search=${encodeURIComponent(search)}`, { cache: 'no-store' }),
        selected ? fetch(`/api/inbox/website-chats?session=${encodeURIComponent(selected)}`, { cache: 'no-store' }) : null,
      ]);
      if (!list.ok || (thread && !thread.ok)) throw new Error('Could not load website chats.');
      const listData = await list.json();
      const threadData = thread ? await thread.json() : null;
      if (version !== requestVersion.current) return;
      setChats(listData.chats);
      setMessages(threadData?.messages ?? []);
      setError('');
    } catch { if (version === requestVersion.current) setError('Could not load website chats.'); }
  }, [selected, search]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { requestVersion.current++; window.clearInterval(timer); };
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="w-48 shrink-0 overflow-y-auto border-r sm:w-80">
        <div className="border-b p-3 text-sm font-semibold">Website chats</div>
        <div className="border-b p-3"><input aria-label="Search visitor questions" placeholder="Search visitor questions" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></div>
        {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
        {!error && chats.length === 0 && <p className="p-3 text-sm text-muted-foreground">{search ? 'No matching questions.' : 'No website chats yet.'}</p>}
        {chats.map((chat) => (
          <button key={chat.id} type="button" onClick={() => { setMessages([]); setSelected(chat.id); }}
            className={`block w-full border-b p-3 text-left hover:bg-muted ${selected === chat.id ? 'bg-muted' : ''}`}>
            <span className="block text-sm font-medium">Website visitor</span>
            <span className="block truncate text-xs text-muted-foreground">{chat.last_message_text}</span>
            <span className="block text-xs text-muted-foreground">{new Date(chat.last_message_at).toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b p-3 text-sm font-semibold">{selected ? 'Website visitor' : 'Select a website chat'}</div>
        {selected && <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => <div key={message.id} className={`max-w-[85%] rounded-lg p-3 text-sm whitespace-pre-wrap ${message.role === 'user' ? 'bg-muted' : 'ml-auto bg-primary/10'}`}>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{message.role === 'user' ? 'Visitor' : 'AI assistant'}</div>
              {message.content}
            </div>)}
          </div>
          <div className="border-t p-3 text-xs text-muted-foreground">Website chats are view-only here. Visitors can continue with your team on WhatsApp.</div>
        </>}
      </div>
    </div>
  );
}
