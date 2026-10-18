# Purpose-based template CTAs

In Settings → Templates → New template, choose **Template purpose** and click
**Use suggested CTA**. This fills the first URL button (or adds one), its dynamic
URL and an example for review. Existing body copy and other buttons remain intact.
Review the suggestion before saving or submitting to Meta.

| Purpose                    | Button            | URL variable in flows          |
| -------------------------- | ----------------- | ------------------------------ |
| Payment request / reminder | Pay now           | `payment_url_suffix`           |
| Courier tracking           | Track order       | `tracking_url_redirect_suffix` |
| Checkout recovery          | Complete purchase | `checkout_url_suffix`          |
| Order details              | View order        | `order_status_url_suffix`      |
| Custom                     | User-defined      | Manual mapping                 |

Payment uses `https://rzp.io/{{1}}`. Tracking uses this CRM's `/t/{{1}}` redirect,
so carrier domains can differ. Checkout and order-status buttons need the domain
from the corresponding customer links, which can differ from the storefront.
The suffix includes the entire path and query, so their approved base is the
origin followed by `/{{1}}`.

Each suggested URL button stores its purpose in the existing JSON button data;
no database migration is required. Purpose is local metadata, excluded from the
Meta API payload, and retained on sync only if the URL and label still match.
Editing the raw URL switches it to Custom to prevent an incorrect automatic mapping.

Selecting the approved template in a flow fills empty CTA mappings by purpose.
Manual mappings are preserved. The runtime checks a purpose-specific link exists;
it never substitutes an order-status URL for a missing payment link.

**Create payment template** in Collect payment opens creation in a separate tab
with Payment preselected, protecting unsaved flow edits. Standard template steps
suggest Tracking, Checkout recovery or Order details from their trigger type.
Template approval and the final save/submit remain explicit user actions.
