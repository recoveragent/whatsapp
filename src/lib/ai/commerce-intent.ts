import type { ChatMessage } from './types';
import { latestUserMessage } from './query';

/** New-purchase phrasing, independent of a brand or product category. */
export function isNewPurchaseQuery(text: string): boolean {
  // Existing-order problems take precedence, including mixed requests.
  if (
    /\b(track(?:ing)?|status|refunds?|returns?|exchanges?|cancel(?:lation|led|ed)?|damaged|broken|wrong item|payments?|charged|delivered|not arrived|missing|late|delayed|lost|edit|change|modify|already ordered|already placed)\b/i.test(
      text
    ) ||
    /\border\s+(?:number|id|history|confirmation|details|update)\b/i.test(
      text
    ) ||
    /\b(?:where|when)\b.*\b(?:order|arrive|delivery)\b/i.test(text)
  )
    return false;
  if (
    /\b(?:i|we)\s+(?:want|need|would like|am looking for|are looking for)\s+(?:a|an|some|the)\s+\w+/i.test(
      text
    )
  )
    return true;
  return /\b(?:want|need|like|ready|plan|planning|wish)\s+(?:to\s+)?order\b|\b(?:can|could|may)\s+(?:i|we)\s+order\b|\bhow\s+(?:(?:can|do)\s+(?:i|we)\s+|to\s+)order\b|\b(?:place|placing)\s+(?:(?:a|an|another|new)\s+){0,2}order\b|^\s*(?:please\s+)?order\s+(?:a|an|some)\b/i.test(
    text
  );
}

// These gates prevent a previous shopping conversation from turning an
// order-support reply into a product carousel. They are conservative hints;
// the model still interprets the full transcript, in any language.
export function isOrderSupportQuery(text: string): boolean {
  if (isNewPurchaseQuery(text)) return false;
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
  if (isNewPurchaseQuery(latest)) return false;
  if (isOrderSupportQuery(latest)) return true;
  const users = messages.filter((message) => message.role === 'user');
  return (
    latest.trim().length <= 60 &&
    users.length > 1 &&
    isOrderSupportQuery(users[users.length - 2].content)
  );
}
