'use client';
import { useEffect, useState } from 'react';

export function InstagramSettings() {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const status = new URLSearchParams(window.location.search).get('instagram'); if (status === 'failed') setError('Instagram connection did not complete. Please try again.'); if (status === 'select_one') setError('Select exactly one Instagram account when connecting.'); fetch('/api/instagram').then(async r => { if (!r.ok) throw new Error(); const d = await r.json(); setNames(d.connections.map((c: { username: string }) => c.username)); }).catch(() => setError('Could not load Instagram connection.')); }, []);
  const connect = async () => {
    setBusy(true); setError('');
    try { const response = await fetch('/api/instagram/connect', { method: 'POST' }); const data = await response.json(); if (!response.ok || !data.url) throw new Error(); window.location.assign(data.url); }
    catch { setError('Instagram login is not available yet. Check the server configuration.'); setBusy(false); }
  };
  return <section className="space-y-4"><h2 className="text-lg font-semibold">Instagram messaging</h2><p className="text-sm text-muted-foreground">Connect a professional Instagram account to receive and reply to direct messages. Meta will ask for access to your Instagram account and messaging.</p>{names.map(name => <p key={name} className="text-sm">Connected: @{name}</p>)}<button type="button" onClick={connect} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? 'Opening Meta…' : 'Connect Instagram'}</button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</section>;
}
