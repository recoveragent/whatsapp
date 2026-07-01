import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  getEmbeddedSignupConfigId,
  getMetaAppId,
  isEmbeddedSignupEnabled,
} from '@/lib/whatsapp/embedded-signup';

/**
 * GET /api/whatsapp/embedded-signup/config
 *
 * Returns client-safe Embedded Signup parameters for brand admins.
 */
export async function GET() {
  try {
    await getCurrentAccount();

    if (!isEmbeddedSignupEnabled()) {
      return NextResponse.json({ enabled: false });
    }

    return NextResponse.json({
      enabled: true,
      appId: getMetaAppId(),
      configId: getEmbeddedSignupConfigId(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
