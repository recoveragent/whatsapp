'use client';
import { useEffect, useState } from 'react';
import { CameraIcon, EllipsisVerticalIcon, LoaderCircleIcon, RefreshCwIcon, UnplugIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InstagramCommentRules } from './instagram/comment-rules';
import { ConfirmDialog, type Confirm } from './instagram/confirm-dialog';
import type { Connection } from './instagram/types';
import { SettingsChip, StatusDot } from './settings-chip';
import { SettingsPanelHead } from './settings-panel-head';

const STATUS: Record<string, string> = {
  failed: 'Instagram connection did not complete. Please try again.',
  select_one: 'Select exactly one Instagram account when connecting.',
};

export function InstagramSettings() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  useEffect(() => {
    const status = STATUS[new URLSearchParams(window.location.search).get('instagram') ?? ''];
    if (status) setError(status);
    fetch('/api/instagram').then(async (r) => { if (!r.ok) throw new Error(); setConnections((await r.json()).connections); }).catch(() => { setConnections([]); setError('Could not load Instagram connection.'); });
  }, []);
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/instagram/connect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error();
      window.location.assign(data.url);
    } catch { setError('Instagram login is not available yet. Check the server configuration.'); setBusy(false); }
  };
  const disconnect = (connection: Connection) => setConfirm({
    title: `Disconnect @${connection.username}?`, action: 'Disconnect', destructive: true,
    body: <p>New messages will stop arriving in this workspace and comment rules will stop. Existing conversations are kept.</p>,
    run: async () => {
      const response = await fetch('/api/instagram', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: connection.id }) });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || 'Could not disconnect Instagram.'); }
      setConnections((current) => (current ?? []).filter((c) => c.id !== connection.id));
    },
  });
  const tile = <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><CameraIcon className="size-6" /></span>;

  return (
    <div className="space-y-8">
      <section>
        <SettingsPanelHead title="Instagram" description="Receive and reply to direct messages, and answer comments by DM." />
        {error && <p role="alert" className="mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
        <Card className="gap-0 py-0">
          {connections === null && <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />Loading</p>}
          {connections?.length === 0 && (
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              {tile}
              <div className="min-w-0 flex-1"><p className="font-semibold">Connect your Instagram account</p><p className="text-sm text-muted-foreground">You need a professional account. Meta will ask for access to messages and comments.</p></div>
              <Button onClick={() => void connect()} disabled={busy} className="self-start sm:self-auto">{busy ? 'Please wait' : 'Connect Instagram'}</Button>
            </div>
          )}
          {connections?.map((connection) => (
            <div key={connection.id} className="flex items-center gap-4 border-b border-border p-5 last:border-b-0">
              {tile}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold"><span className="truncate">@{connection.username}</span>{connection.token_error ? <SettingsChip variant="warn">Needs attention</SettingsChip> : <SettingsChip variant="ok"><StatusDot />Connected</SettingsChip>}</p>
                <p className="text-sm text-muted-foreground">{connection.token_error ?? (connection.token_expires_at ? `Login valid until ${new Date(connection.token_expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Renews automatically when possible.` : 'Messages and comments are connected.')}</p>
              </div>
              {connection.token_error && <Button size="sm" onClick={() => void connect()} disabled={busy}>Reconnect</Button>}
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={`Options for @${connection.username}`} />}><EllipsisVerticalIcon /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem disabled={busy} onClick={() => void connect()}><RefreshCwIcon />Reconnect</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => disconnect(connection)}><UnplugIcon />Disconnect</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </Card>
      </section>
      {connections && <InstagramCommentRules connections={connections} />}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
