import 'server-only';
import {
  buildTemplateMessagePayload,
  sendTemplateMessage as sendToMeta,
  type SendTemplateMessageArgs,
  type MetaSendResult,
} from './meta-api';
import { trackRecoverableTemplate } from './smart-retry';

async function record(
  args: SendTemplateMessageArgs,
  messageId: string | null,
  code?: number
) {
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    return;
  try {
    await trackRecoverableTemplate(
      args.phoneNumberId,
      buildTemplateMessagePayload(args),
      messageId,
      code
    );
  } catch (error) {
    // An already accepted send must never become a caller-visible send failure.
    console.error('[smart-retry] unable to record template send:', error);
  }
}

/** Shared server entrypoint for all outbound template sends. */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  let result: MetaSendResult;
  try {
    result = await sendToMeta(args);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 131049
    ) {
      await record(args, null, 131049);
    }
    throw error;
  }
  await record(args, result.messageId);
  return result;
}
