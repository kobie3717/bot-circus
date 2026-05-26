# Custom Runtime Justification

This bot uses a custom runtime because it has bespoke long-poll loop with
hardware webhooks. Shared/sidecar modes do not fit.

Reviewer signoff: test
