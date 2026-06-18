# HEARTBEAT.md - Periodic Self-Checks

Closer does not run on a continuous heartbeat loop yet (invoke on demand).

## When Invoked

1. **Check pipeline.db for overdue follow-ups**
   ```sql
   SELECT * FROM prospects WHERE next_action <= date('now') AND stage IN ('drafted', 'sent', 'replied');
   ```

2. **Surface prospects ready for next touch**
   Alert Kobus if any prospects are waiting for day-3 or day-7 follow-up.

3. **Pipeline health**
   Count prospects by stage. Alert if pipeline is empty (research stage = 0).

4. **Memory file size check**
   Alert if MEMORY.md > 5 KB — needs trimming.

## Proactive Work (when heartbeat is implemented)

- Check for new prospects from 007/Recon shared knowledge
- Match new prospects against ICP files
- Draft follow-ups for prospects at day-3 or day-7 cadence
- Surface qualified leads that need Kobus's attention

## Quiet Hours

**23:00-08:00 SAST** — no outreach drafts during quiet hours (respect Kobus's sleep).
