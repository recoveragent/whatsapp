import type { SupabaseClient } from '@supabase/supabase-js';

import type { DashboardSignupWorkspace } from '@/lib/auth/sso';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Give a merchant who signed up on the Recover Agent dashboard their workspace.
 * Must run before the store connection imports, which need a linked workspace.
 * The details come from the one-time ticket response, never from the browser.
 */
export async function ensureDashboardSignupWorkspace(args: {
  sessionClient: SupabaseClient;
  workspace: DashboardSignupWorkspace;
}): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await args.sessionClient.auth.getUser();
  if (userError || !user) throw new Error('Could not resolve the WhatsApp CRM user');

  const { error } = await supabaseAdmin().rpc('provision_dashboard_signup_workspace', {
    p_user_id: user.id,
    p_company_id: args.workspace.company_id,
    p_name: args.workspace.name,
    p_ecommerce_platform: args.workspace.ecommerce_platform,
  });
  if (error) throw new Error(error.message);
}
