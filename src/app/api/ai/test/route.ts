import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
export async function POST() {
  try {
    await requireAiAgentsAccount('admin');
    return NextResponse.json(
      {
        error:
          'AI model and credential tests are managed by super admin. Use the playground to test replies.',
      },
      { status: 403 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
