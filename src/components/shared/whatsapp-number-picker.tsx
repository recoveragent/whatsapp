'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Label } from '@/components/ui/label';

export interface WhatsAppNumberOption {
  id: string;
  reference_name: string;
  phone_number_id: string;
}

export function WhatsAppNumberPicker({
  value,
  onChange,
  id = 'whatsapp-number',
  label = 'From WhatsApp number',
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
}) {
  const [numbers, setNumbers] = useState<WhatsAppNumberOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from('whatsapp_config')
      .select('id, reference_name, phone_number_id')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const rows = data as WhatsAppNumberOption[];
        setNumbers(rows);
        if (!value && rows[0]) onChange(rows[0].id);
      });
    return () => { cancelled = true; };
  }, [onChange, value]);

  if (numbers.length <= 1) return null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
      >
        {numbers.map((number) => (
          <option key={number.id} value={number.id}>
            {number.reference_name} ({number.phone_number_id})
          </option>
        ))}
      </select>
    </div>
  );
}
