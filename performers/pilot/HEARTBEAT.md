# HEARTBEAT.md - Periodic Self-Checks

Pilot does not run on a continuous heartbeat loop yet (invoke on demand for deploys).

## When Invoked

1. **Check for pending deploys**
   Surface any commits to main branch that haven't been deployed yet.

2. **Health check all projects**
   Verify all API health endpoints return 200.

3. **Error rate monitoring**
   Check logs for error spikes (>5% error rate = alert).

4. **Memory file size check**
   Alert if MEMORY.md > 5 KB — needs trimming.

## Post-Deploy (within 5 min)

1. **Smoke test critical paths**
   Run automated smoke tests for deployed project.

2. **Health gates**
   Verify all health gates pass. If any fail, auto-rollback.

3. **Error rate check**
   Monitor logs for 5 min. If error rate >5%, rollback.

4. **Release notes**
   Auto-generate from git commits, store in deploy-log.db.

## Quiet Hours

**23:00-08:00 SAST** — no deploys during quiet hours (unless customer-blocking emergency).

**Friday 14:00-23:59 SAST** — no deploys on Friday afternoons (unless emergency).
