import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Direct Send capability migration', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE TABLE public.whatsapp_config (id text PRIMARY KEY, phone_number_id text, waba_id text, status text);
      INSERT INTO public.whatsapp_config VALUES ('one', 'phone-one', 'waba-one', 'connected'), ('two', 'phone-two', 'waba-two', 'connected');`);
    await db.exec(
      readFileSync(
        'supabase/migrations/20261021064434_whatsapp_direct_send_availability.sql',
        'utf8'
      )
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it('defaults existing accounts to unknown', async () => {
    const { rows } = await db.query<{ direct_send_status: string }>(
      'SELECT direct_send_status FROM public.whatsapp_config'
    );
    expect(rows.map((r) => r.direct_send_status)).toEqual([
      'unknown',
      'unknown',
    ]);
  });
  it('keeps account statuses independent', async () => {
    await db.exec(
      "UPDATE public.whatsapp_config SET direct_send_status = 'enabled' WHERE id = 'one'"
    );
    const { rows } = await db.query<{ direct_send_status: string }>(
      "SELECT direct_send_status FROM public.whatsapp_config WHERE id = 'two'"
    );
    expect(rows[0].direct_send_status).toBe('unknown');
  });
  it('resets access when replacing a number or WABA, or disconnecting', async () => {
    for (const update of [
      "phone_number_id = 'replacement'",
      "waba_id = 'replacement'",
      "status = 'disconnected'",
    ]) {
      await db.exec(
        "UPDATE public.whatsapp_config SET status = 'connected', direct_send_status = 'enabled' WHERE id = 'one'"
      );
      await db.exec(
        `UPDATE public.whatsapp_config SET ${update} WHERE id = 'one'`
      );
      const { rows } = await db.query<{ direct_send_status: string }>(
        "SELECT direct_send_status FROM public.whatsapp_config WHERE id = 'one'"
      );
      expect(rows[0].direct_send_status).toBe('unknown');
    }
  });
  it('rejects invalid statuses', async () => {
    await expect(
      db.exec(
        "UPDATE public.whatsapp_config SET direct_send_status = 'yes' WHERE id = 'two'"
      )
    ).rejects.toThrow();
  });
});
