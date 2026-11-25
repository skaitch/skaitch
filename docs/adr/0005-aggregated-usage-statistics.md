# Usage statistics as aggregated daily counters

The web app's server functions (`api/ai`, `api/bim`, `api/mcp`) increment, on every operation, daily Firestore counters (UTC day): one set per operation and one set per account, with the number of calls per outcome (succeeded, refused, failed, timed out) and durations spread into fixed buckets. No per-call record is kept. Per-operation totals are kept indefinitely; per-account totals are deleted after 90 days. A failed count never makes the user's operation fail. These documents are only readable by Firebase Admin, through an API reserved to administrators.

skAItch only measures what the consoles cannot tell: the split per operation (the three functions are routes with an `operation` parameter, seen as one block by Vercel) and usage per account. Raw infrastructure load (invocations, memory, Firestore reads and writes) is read in the Vercel and Firebase consoles and is not duplicated.

## Considered Options

- One record per call (account, operation, duration, outcome, time): rejected. It would allow exact durations and unforeseen questions about the past, but its volume grows without end, the page would aggregate thousands of rows on every display, and a timestamped history of each user would be kept. Vercel logs already cover fine detail for the last days.
- Showing everything in skAItch, raw load included: rejected, it amounts to rebuilding the existing consoles.

## Consequences

- A question the counters did not foresee cannot be reconstructed for the past; adding a dimension only counts from its deployment.
- The median and the 95th percentile of durations are approximations bounded by the buckets.
- Each operation costs one or two extra Firestore writes.
- Per-account tracking is processing of personal data: it must appear in the privacy policy before going to production.
