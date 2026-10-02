import { describe, expect, it } from 'vitest';
import { resolveActiveChannel, type ChannelWorkspace } from './channel-workspace';

const primary: ChannelWorkspace = { id: 'wa-primary', accountId: 'brand', name: 'Primary', phoneNumberId: '1', status: 'connected' };
const support: ChannelWorkspace = { id: 'wa-support', accountId: 'support-tenant', name: 'Support', phoneNumberId: '2', status: 'connected' };

describe('active channel resolution', () => {
  it('requires an explicit choice when a brand has multiple channels', () => {
    expect(resolveActiveChannel([primary, support])).toBeNull();
  });
  it('resolves the chosen workspace without falling back to another sender', () => {
    expect(resolveActiveChannel([primary, support], support.accountId)).toEqual(support);
    expect(resolveActiveChannel([primary, support], 'another-brand')).toBeNull();
    expect(resolveActiveChannel([primary], 'removed-channel')).toBeNull();
  });
  it('supports the unambiguous single-channel and setup cases', () => {
    expect(resolveActiveChannel([primary])).toEqual(primary);
    expect(resolveActiveChannel([])).toBeNull();
  });
});
