// ============================================================
// AI agent go-live readiness.
//
// One ordered checklist a brand works down before switching auto-reply
// on. `required` items block a useful live agent; the rest improve
// answers. Pure so the rules are unit-testable; the route gathers facts.
// ============================================================

export interface ReadinessFacts {
  modelConfigured: boolean;
  whatsappConnected: boolean;
  /** null when the brand isn't on Shopify. */
  shopifyConnected: boolean | null;
  catalogVariants: number | null;
  knowledgeDocuments: number;
  hasBusinessInstructions: boolean;
  playgroundTested: boolean;
  assistantOn: boolean;
  autoReplyOn: boolean;
  /** Active `new_message_received` automations — each answers every
   *  message itself, so the agent stands down on every message. */
  catchAllAutomations: number;
}

export type ReadinessAction =
  | 'super_admin'
  | 'whatsapp_settings'
  | 'shopify_settings'
  | 'train'
  | 'setup'
  | 'playground'
  | 'automations';

export interface ReadinessCheck {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  required: boolean;
  action: ReadinessAction;
}

export function buildReadinessChecks(f: ReadinessFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [
    {
      id: 'model',
      label: 'AI model connected',
      detail: f.modelConfigured
        ? 'Your super admin has set up the AI model.'
        : 'Ask your super admin to add an AI model and key for this brand.',
      done: f.modelConfigured,
      required: true,
      action: 'super_admin',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp number connected',
      detail: f.whatsappConnected
        ? 'Customer messages reach the agent.'
        : 'Connect a WhatsApp number in Settings.',
      done: f.whatsappConnected,
      required: true,
      action: 'whatsapp_settings',
    },
  ];

  if (f.shopifyConnected !== null) {
    checks.push(
      {
        id: 'shopify',
        label: 'Shopify store connected',
        detail: f.shopifyConnected
          ? 'Order lookups and product recommendations are available.'
          : 'Connect your store so the agent can look up orders and recommend products.',
        done: f.shopifyConnected,
        required: true,
        action: 'shopify_settings',
      },
      {
        id: 'catalog',
        label: 'Product catalog synced',
        detail:
          f.catalogVariants && f.catalogVariants > 0
            ? `${f.catalogVariants} active variants available for recommendations.`
            : 'Sync products in store settings so the agent can recommend them.',
        done: !!f.catalogVariants && f.catalogVariants > 0,
        required: false,
        action: 'shopify_settings',
      }
    );
  }

  checks.push(
    {
      id: 'knowledge',
      label: 'Agent trained on your policies and FAQs',
      detail:
        f.knowledgeDocuments > 0
          ? `${f.knowledgeDocuments} knowledge ${f.knowledgeDocuments === 1 ? 'document' : 'documents'}.`
          : 'Import your store policies or add FAQs so the agent can answer shipping, COD and return questions.',
      done: f.knowledgeDocuments > 0,
      required: true,
      action: 'train',
    },
    {
      id: 'instructions',
      label: 'Business instructions written',
      detail: f.hasBusinessInstructions
        ? 'Tone and rules are set.'
        : 'Describe your brand, tone, and anything the agent must or must not say.',
      done: f.hasBusinessInstructions,
      required: false,
      action: 'setup',
    },
    {
      id: 'playground',
      label: 'Replies tested in the Playground',
      detail: f.playgroundTested
        ? 'You have tested the agent.'
        : 'Ask it your top customer questions before going live.',
      done: f.playgroundTested,
      required: false,
      action: 'playground',
    }
  );

  if (f.catchAllAutomations > 0) {
    checks.push({
      id: 'automations',
      label: 'No catch-all auto-responder',
      detail: `${f.catchAllAutomations} active “new message” ${f.catchAllAutomations === 1 ? 'automation answers' : 'automations answer'} every message, so the agent stays silent. Pause ${f.catchAllAutomations === 1 ? 'it' : 'them'} or switch to keyword triggers.`,
      done: false,
      required: true,
      action: 'automations',
    });
  }

  checks.push({
    id: 'live',
    label: 'Auto-replies switched on',
    detail:
      f.assistantOn && f.autoReplyOn
        ? 'The agent is answering customers on WhatsApp.'
        : 'Turn on the assistant and automatic replies in Setup.',
    done: f.assistantOn && f.autoReplyOn,
    required: true,
    action: 'setup',
  });

  return checks;
}

/** Live means every required check passes. */
export function isAgentLive(checks: ReadinessCheck[]): boolean {
  return checks.every((c) => c.done || !c.required);
}
