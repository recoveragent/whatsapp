# Scheduled broadcasts

In the last step of a new broadcast, choose **Schedule** beside **Save as Draft**
and **Send Broadcast**. Select a future date and time; the dialog displays the
browser's timezone. The timestamp is stored in UTC and displayed in local time
on the broadcast list and detail page.

Scheduling prepares and stores the audience and each recipient's template
variables immediately. No messages are sent during preparation. The selected
header media URL is saved with the campaign. The broadcast becomes `scheduled`
only after all recipient rows have been saved.

Delivery uses the existing automation scheduler. Long-lived production Node
hosts run it roughly every minute when `AUTOMATION_CRON_SECRET` is configured
and `DISABLE_INTERNAL_AUTOMATION_CRON` is not `1`. Serverless deployments need
an external job calling `/api/automations/cron` with the `x-cron-secret` header,
as for other scheduled automations. Sending starts on the first scheduler tick
after the selected time. The application must be deployed and running; the
browser does not need to remain open.

The worker uses the existing delivery lock and processes bounded batches.
Unfinished scheduled campaigns continue on subsequent ticks. Manual resume
cannot start a scheduled broadcast before its due time. Infrastructure failures
leave pending recipients available for another tick; invalid delivery plans are
marked failed and reported in server logs.
