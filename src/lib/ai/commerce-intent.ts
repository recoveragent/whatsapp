import type { ChatMessage } from './types';
import { latestUserMessage } from './query';

// These gates prevent a previous shopping conversation from turning an
// order-support reply into a product carousel. They are conservative hints;
// the model still interprets the full transcript, in any language.
export function isOrderSupportQuery(text: string): boolean {
  return (
    /\b(orders?|tracking|shipments?|shipping|delivery|delivered|dispatch|parcels?|packages?|refunds?|returns?|exchanges?|cancel|cancellation|payments?|charged|damaged|broken|wrong item)\b/i.test(
      text
    ) ||
    /ऑर्डर|डिलीवरी|रिफंड|वापस|रद्द|ट्रैक|பார்சல்|ஆர்டர்|डिलिव्हरी/i.test(text)
  );
}

export function isHumanSupportQuery(text: string): boolean {
  return /\b(human|agent|representative|supervisor|complaint|support team|talk to someone|speak to someone)\b/i.test(
    text
  );
}

/** Refresh order information only for order support, including short replies
 * to a recent order question (e.g. an order number or "the second one"). */
export function shouldRefreshShopifyOrders(messages: ChatMessage[]): boolean {
  const latest = latestUserMessage(messages);
  if (isOrderSupportQuery(latest)) return true;
  const users = messages.filter((message) => message.role === 'user');
  return (
    latest.trim().length <= 60 &&
    users.length > 1 &&
    isOrderSupportQuery(users[users.length - 2].content)
  );
}
