# Flow conditions

Condition nodes route to true/false. Switch branches are evaluated in order; the first matching branch wins, otherwise the else path runs. Both support a single predicate or up to 20 predicates combined with ALL (AND) or ANY (OR). Evaluation short-circuits.

Existing captured-variable, contact-tag, contact-field and Shopify-payment predicates remain supported. New Shopify-triggered conditions default to the resource that started the run. Order conditions cannot be activated on checkout or non-Shopify triggers, and checkout conditions cannot be activated on order triggers.

## Shopify fields

Order conditions include payment status, payment gateways, COD, open/cancelled/closed status, amount and currency, fulfillment and shipment status, products, variants, SKUs, tags, delivery-address fields, tracking, quantities, discount codes and amounts, creation time and age, and customer history. Checkout conditions expose the applicable checkout fields; payment, fulfillment and order status are not offered.

Money uses raw numeric amounts in the resource's currency. Combine amount and currency rules for stores handling multiple currencies. List conditions match whole members, so tag `VIP` does not match `VIP-new`. Product/variant fields offer catalog search, including out-of-stock products; IDs and SKUs can also be entered directly. List inputs use comma-separated values for contains-any/all and is-one-of.

COD checks payment-gateway names, never pending payment status. The default names are Cash on Delivery (COD), Cash on Delivery and COD. Customize the comma-separated names on the condition; matching is exact and ignores case.

## Snapshot versus latest state

The event snapshot describes the triggering order/checkout. Latest state fetches that same order by its Shopify ID using the account's connection, with caching disabled. Reads are shared within a node evaluation, but refreshed when another node executes or a run resumes after waiting. Latest checkout state is not offered: third-party cart tokens are not necessarily Shopify checkout IDs.

Customer lifetime order count always reads Shopify's customer record. Previous-order count and first/repeat-order checks count orders created strictly before the triggering order's creation timestamp. They paginate customer history and fail if visible orders are fewer than Shopify's lifetime count. Historical access may require `read_all_orders` in addition to the existing order/customer scopes. Orders with the exact same timestamp are not classified as preceding each other.

Latest-state and history lookup failures stop the run with an error; they do not silently fall back to stale snapshots. Missing Shopify fields do not match comparisons, including negative comparisons. Use is-present/is-absent when testing availability. The run timeline exposes the field, data source, outcome, and missing-data flag for each evaluated rule. Short-circuited rules are not evaluated or logged.

Third-party checkout integrations normalize supplied structured items, addresses, totals, currency, discount and customer data. Unknown fields remain unavailable; product display text is never used to guess IDs or quantities. Older active runs without a structured snapshot can continue using their legacy conditions; new Shopify snapshot conditions require a newly triggered run, or latest state for an order.

## Example: COD confirmation

1. Shopify order placed.
2. ALL: COD equals true; order status equals open; payment status is one of pending, partially_paid.
3. Request address confirmation.
4. Wait.
5. ALL, using latest state: order status equals open; payment status is one of pending, partially_paid.
6. Follow up only on the true branch.

No database migration is required; predicates and snapshots use the existing flow config and run-variable JSON columns.
