# Next step and Timeout

Next step starts as soon as the source node executes. It does not wait for a
button click or typed response. A Wait node on this path delays subsequent
actions by its configured duration, regardless of customer replies.

For nodes that wait for replies, the engine keeps the reply path active and
starts Next step in an independent run of the same flow. Button branches still
handle replies to the original message. Reaching End on a reply branch does not
cancel the independent Next step path. Flow exit rules and agent pauses still
apply to live runs.

Timeout starts after the prompt is sent and only executes if the customer does
not respond during the configured duration. Either a button click or typed
response cancels outstanding reply timeouts for that contact's active runs,
including text that does not match a configured button. Templates without
buttons can also have a Timeout path.

For example, connect an order confirmation's Next step to Wait (15 minutes),
then to a softcopy template. Address confirmation replies do not cancel that
softcopy send. Connect the softcopy's Timeout (4 hours) to a reminder to send the
reminder only when the customer stays silent after the softcopy.

Next step uses variables available when its path starts. For input and form
nodes, values supplied later by the customer are captured on the original run;
they are not available to actions that have already started independently.
The reply does not execute Next step a second time.

Independent paths appear as separate runs in flow history, with their started
event recording the parent run and source node. Existing suspended runs are
not replayed when the engine is deployed; the new behavior applies when nodes
execute after deployment.
