import type { FlowSnapshot, FlowNodeSnapshot } from './clone-flow-snapshot';

function node(
  node_key: string,
  node_type: string,
  config: Record<string, unknown>,
  x: number,
  y: number
): FlowNodeSnapshot {
  return { node_key, node_type, config, position_x: x, position_y: y };
}

/** Brand copies remain drafts until their WhatsApp templates and gateway are configured. */
export const CHECKOUT_RECOVERY_SNAPSHOT: FlowSnapshot = {
  name: 'Abandoned checkout — COD or UPI',
  description:
    'Recover Agent / checkout-app recovery. Choose COD confirmation in WhatsApp or checkout-page routing in Review COD checkout. Online payments use the saved checkout total and create a paid Shopify order. Select approved recovery_payment_choice and recovery_payment_request templates for each brand before activation. Native Shopify stores can change the trigger to Shopify: abandoned checkout.',
  trigger_type: 'shopify_checkout_app_abandoned',
  trigger_config: {
    phone_path: 'phone',
    name_path: 'customer_name',
    variable_mappings: {
      checkout_id: 'checkout_id',
      checkout_url: 'checkout_url',
      order_total: 'amount',
    },
    skip_recent_order_enabled: true,
    skip_recent_order_days: 1,
  },
  entry_node_id: 'start',
  fallback_policy: {
    on_unknown_reply: 'reprompt',
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: 'handoff',
  },
  exit_config: {
    conditions: [{ id: 'agent_assigned', type: 'conversation_assigned' }],
  },
  nodes: [
    node('start', 'start', { next_node_key: 'recovery_message' }, 0, 0),
    node(
      'recovery_message',
      'send_template',
      {
        template_name: 'recovery_payment_choice',
        language: 'en_US',
        variables: {
          // Each brand uploads its header image fallback in the flow before activation.
          header_media: '{{ vars.product_image }}',
          '1': '{{ vars.customer_name | "Customer" }}',
          '2': '{{ vars.order_items | "your items" }}',
          '3': '{{ vars.order_total | "See checkout" }}',
          '4': '{{ vars.shipping_address | "Confirm on checkout" }}',
        },
        buttons: [
          {
            reply_id: 'Cash on Delivery',
            title: 'Cash on Delivery',
            next_node_key: 'review_cod',
          },
          {
            reply_id: 'Pay by UPI',
            title: 'Pay by UPI',
            next_node_key: 'collect_checkout_payment',
          },
        ],
        next_node_key: '',
      },
      0,
      150
    ),
    node(
      'review_cod',
      'recover_checkout',
      {
        action: 'prepare_cod',
        cod_mode: 'create_order',
        ready_next: 'confirm_cod',
        checkout_next: 'checkout_link',
        failed_next: 'assistance',
      },
      -320,
      330
    ),
    node(
      'confirm_cod',
      'send_buttons',
      {
        text: '{{ vars.checkout_order_summary | "Please contact us to review your order." }}\n\nPayment: Cash on Delivery. Shall we place this order?',
        buttons: [
          {
            reply_id: 'confirm_cod',
            title: 'Confirm COD order',
            next_node_key: 'place_cod',
          },
          {
            reply_id: 'change_details',
            title: 'Change details',
            next_node_key: 'checkout_link',
          },
          {
            reply_id: 'cancel_recovery',
            title: 'Not now',
            next_node_key: 'end',
          },
        ],
      },
      -320,
      540
    ),
    node(
      'place_cod',
      'recover_checkout',
      {
        action: 'place_cod',
        cod_mode: 'create_order',
        ready_next: 'cod_receipt',
        checkout_next: 'assistance',
        failed_next: 'assistance',
      },
      -320,
      760
    ),
    node(
      'cod_receipt',
      'send_message',
      {
        text: 'Your COD order {{ vars.order_number | "confirmed" }} has been placed. Pay INR {{ vars.checkout_amount | "the confirmed total" }} on delivery. Thank you!',
        next_node_key: 'end',
      },
      -320,
      960
    ),
    node(
      'checkout_link',
      'send_message',
      {
        text: 'Please complete your order securely here: {{ vars.checkout_url | "Please ask our team for your checkout link." }}\nYou can review your address and choose from the payment options available on checkout.',
        next_node_key: 'end',
      },
      -640,
      760
    ),
    node(
      'collect_checkout_payment',
      'collect_payment',
      {
        provider: 'razorpay',
        razorpay_checkout: 'upi',
        currency: 'INR',
        amount: 0,
        shopify_checkout_recovery: true,
        description: 'Complete your checkout',
        expiry_hours: 1,
        reminder_minutes: 15,
        max_reminders: 1,
        request_template: {
          template_name: 'recovery_payment_request',
          language: 'en_US',
          variables: {
            '1': '{{ vars.customer_name | "Customer" }}',
            '2': '{{ vars.payment_amount | "See payment page" }}',
            '3': '{{ vars.payment_url | "Payment link unavailable. Please contact us." }}',
          },
          next_node_key: '',
        },
        reminder_template: {
          template_name: 'recovery_payment_request',
          language: 'en_US',
          variables: {
            '1': '{{ vars.customer_name | "Customer" }}',
            '2': '{{ vars.payment_amount | "See payment page" }}',
            '3': '{{ vars.payment_url | "Payment link unavailable. Please contact us." }}',
          },
          next_node_key: '',
        },
        paid_next: 'paid_receipt',
        expired_next: 'payment_expired',
        failed_next: 'assistance',
      },
      320,
      330
    ),
    node(
      'paid_receipt',
      'send_message',
      {
        text: 'Payment received. Your order {{ vars.order_number | "confirmed" }} has been placed successfully. Thank you!',
        next_node_key: 'end',
      },
      320,
      540
    ),
    node(
      'payment_expired',
      'send_message',
      {
        text: 'Your payment link has expired. Our team can help you complete your order.',
        next_node_key: 'handoff',
      },
      560,
      760
    ),
    node(
      'assistance',
      'send_message',
      {
        text: 'We could not finish this order automatically. Our team will help you. If you have already paid, please do not pay again.',
        next_node_key: 'handoff',
      },
      80,
      960
    ),
    node(
      'handoff',
      'handoff',
      {
        note: 'Checkout recovery needs assistance. Check payment status and Shopify recovery reference before placing an order or requesting payment.',
      },
      160,
      1140
    ),
    node('end', 'end', {}, -320, 1140),
  ],
};
