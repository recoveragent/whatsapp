'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Pencil, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { WhatsAppFlow } from '@/types';

interface FlowFormData {
  name: string;
  flow_id: string;
  flow_cta: string;
  body_text: string;
  header_text: string;
  footer_text: string;
  flow_screen: string;
}

const emptyForm: FlowFormData = {
  name: '',
  flow_id: '',
  flow_cta: 'Open form',
  body_text: '',
  header_text: '',
  footer_text: '',
  flow_screen: '',
};

export function WhatsAppFlowManager() {
  const { accountId } = useAuth();
  const canManage = useCan('edit-settings');
  const [flows, setFlows] = useState<WhatsAppFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WhatsAppFlow | null>(null);
  const [form, setForm] = useState<FlowFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function loadFlows() {
    if (!accountId) {
      setFlows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('whatsapp_flows')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Failed to load WhatsApp Flows');
      setFlows([]);
    } else {
      setFlows((data as WhatsAppFlow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadFlows();
  }, [accountId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(flow: WhatsAppFlow) {
    setEditing(flow);
    setForm({
      name: flow.name,
      flow_id: flow.flow_id,
      flow_cta: flow.flow_cta,
      body_text: flow.body_text,
      header_text: flow.header_text ?? '',
      footer_text: flow.footer_text ?? '',
      flow_screen: flow.flow_screen ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.flow_id.trim() || !form.body_text.trim()) {
      toast.error('Name, Flow ID, and body text are required');
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `/api/whatsapp/flows/${editing.id}`
        : '/api/whatsapp/flows';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error ?? 'Could not save Flow');
        return;
      }
      toast.success(editing ? 'Flow updated' : 'Flow saved');
      setDialogOpen(false);
      await loadFlows();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(flow: WhatsAppFlow) {
    if (!confirm(`Delete "${flow.name}"?`)) return;
    const res = await fetch(`/api/whatsapp/flows/${flow.id}`, {
      method: 'DELETE',
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(payload.error ?? 'Could not delete Flow');
      return;
    }
    toast.success('Flow deleted');
    await loadFlows();
  }

  const canSave =
    form.name.trim().length > 0 &&
    form.flow_id.trim().length > 0 &&
    form.body_text.trim().length > 0 &&
    form.flow_cta.trim().length > 0;

  return (
    <div className="space-y-4">
      <SettingsPanelHead
        title="WhatsApp Flows"
        description="Save Meta-published Flow forms for manual sends from the inbox — similar to templates."
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Copy the Flow ID from Meta WhatsApp Manager after publishing.
        </p>
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Flow
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : flows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No saved Flows yet. Add one to send forms manually from the inbox.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {flows.map((flow) => (
            <Card key={flow.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
                    <p className="truncate font-medium">{flow.name}</p>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {flow.flow_id}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {flow.body_text}
                  </p>
                  <p className="mt-1 text-[11px] text-primary">
                    CTA: {flow.flow_cta}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(flow)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => void handleDelete(flow)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Flow' : 'Add WhatsApp Flow'}</DialogTitle>
            <DialogDescription>
              These are Meta Flow forms (interactive type flow), not conversational
              Flows from the Flow Builder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Lead capture form"
              />
            </div>
            <div>
              <Label>Flow ID</Label>
              <Input
                value={form.flow_id}
                onChange={(e) => setForm((f) => ({ ...f, flow_id: e.target.value }))}
                placeholder="Meta Flow ID"
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label>CTA button label</Label>
              <Input
                value={form.flow_cta}
                onChange={(e) => setForm((f) => ({ ...f, flow_cta: e.target.value }))}
                placeholder="Open form"
              />
            </div>
            <div>
              <Label>Body text</Label>
              <Textarea
                value={form.body_text}
                onChange={(e) => setForm((f) => ({ ...f, body_text: e.target.value }))}
                rows={3}
                placeholder="Please fill out this form to continue."
              />
            </div>
            <div>
              <Label>Header (optional)</Label>
              <Input
                value={form.header_text}
                onChange={(e) => setForm((f) => ({ ...f, header_text: e.target.value }))}
              />
            </div>
            <div>
              <Label>Footer (optional)</Label>
              <Input
                value={form.footer_text}
                onChange={(e) => setForm((f) => ({ ...f, footer_text: e.target.value }))}
              />
            </div>
            <div>
              <Label>First screen ID (optional)</Label>
              <Input
                value={form.flow_screen}
                onChange={(e) => setForm((f) => ({ ...f, flow_screen: e.target.value }))}
                placeholder="SCREEN_A"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave || saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
