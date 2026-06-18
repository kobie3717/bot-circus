# HEARTBEAT.md - Periodic Self-Checks

Scribe does not run on a continuous heartbeat loop yet (invoke on demand).

## When Invoked

1. **Check for unpublished drafts**
   Surface any drafts in `drafts/` that are ready for Kobus review.

2. **Engagement tracking**
   Poll LinkedIn API for published posts, update content-log.db with engagement data.

3. **Content calendar**
   Suggest topics for upcoming posts based on:
   - Recent product updates (WhatsAuction features, Recon modes)
   - Customer wins (new paying customers, testimonials)
   - Lessons learned (failures, pivots, "what I'd do differently")

4. **Memory file size check**
   Alert if MEMORY.md > 5 KB — needs trimming.

## Proactive Work (when heartbeat is implemented)

- Draft weekly LinkedIn post based on recent activity
- Suggest blog post topics based on Recon/WhatsAuction traction
- Track competitor content (what are similar founders posting?)

## Quiet Hours

**23:00-08:00 SAST** — no content drafting during quiet hours (Kobus is asleep).
