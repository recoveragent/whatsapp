import { format } from 'date-fns';
import {
  deliveryDurations,
  type DeliveryEvent,
} from '@/lib/whatsapp/delivery-diagnostics';

export function DeliveryTimingDetails({
  events,
  runStartedAt,
}: {
  events: DeliveryEvent[];
  runStartedAt: string;
}) {
  if (!events.length) return null;
  const { acceptedToDeliveredMs } = deliveryDurations(events);
  return (
    <details className="mt-1">
      <summary className="cursor-pointer">
        Delivery timing
        {acceptedToDeliveredMs !== null
          ? ` · ${(acceptedToDeliveredMs / 1000).toFixed(1)}s after API response`
          : ' · awaiting complete timing data'}
      </summary>
      <ul className="mt-1 space-y-1">
        {events.map((event, i) => (
          <li key={i} className="break-words">
            {event.event_type === 'api_accepted'
              ? 'API response'
              : `WhatsApp ${event.event_type}`}
            : {format(new Date(event.occurred_at), 'HH:mm:ss')}
            {event.event_type === 'api_accepted' && (
              <>
                {event.details.message_status === 'held_for_quality_assessment'
                  ? ' · Held by Meta for quality assessment'
                  : event.details.message_status
                    ? ` · ${event.details.message_status}`
                    : ' · Meta did not report a hold status'}
                {event.details.api_started_at &&
                  Number.isFinite(Date.parse(event.details.api_started_at)) &&
                  ` · flow processing before API ${Math.max(0, (Date.parse(event.details.api_started_at) - Date.parse(runStartedAt)) / 1000).toFixed(2)}s`}
                {typeof event.details.api_duration_ms === 'number' &&
                  ` · API request ${(event.details.api_duration_ms / 1000).toFixed(2)}s`}
              </>
            )}
            {event.event_type !== 'api_accepted' &&
              ` · webhook received ${format(new Date(event.received_at), 'HH:mm:ss')} (${Math.max(0, (Date.parse(event.received_at) - Date.parse(event.occurred_at)) / 1000).toFixed(1)}s later)`}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Times use your browser timezone. API acceptance does not confirm
        delivery.
      </p>
    </details>
  );
}
