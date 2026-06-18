# Agent Pack Fan-Out Architecture (v2)

**Status:** NOT IMPLEMENTED  
**Current approach:** Flattened single-shot (v1)  
**Why deferred:** v1 works, delivers end-to-end functionality, meets migration goal

## Problem with v1 (Flattened)

Each agent pack (e.g., `agent-redteam`) runs 5+ specialist analyses **sequentially** in a single Claude worker.

- redteam: 5 perspectives (CFO, Market, Legal, Competitor, Execution) + synthesis
- arch_review: 5 perspectives (Scalability, SecurityArch, Cost, Integration, TechDebt) + synthesis
- incident: 5 perspectives (LogAnalyzer, RootCause, Mitigation, Comms, Postmortem) + synthesis

**Impact:**
- Slower than Python's `asyncio.gather` (which ran sub-agents in parallel)
- Single timeout (240s) applies to all sub-analyses — if one is slow, whole pack times out
- No granular failure — if synthesis fails, entire pack fails (can't see partial results)

## Solution: Fan-Out via dispatchAll

### Architecture

Split each pack into N+1 performers:

```
agent-redteam/              (orchestrator — no SOUL.md, pure dispatch logic)
agent-redteam-cfo/          (SOUL.md = CFO prompt only)
agent-redteam-market/       (SOUL.md = Market prompt only)
agent-redteam-legal/        (SOUL.md = Legal prompt only)
agent-redteam-competitor/   (SOUL.md = Competitor prompt only)
agent-redteam-execution/    (SOUL.md = Execution prompt only)
agent-redteam-synthesis/    (SOUL.md = Synthesis prompt only)
```

### Orchestrator Logic (agent-redteam/bot.mjs)

```javascript
import { dispatchAll } from '/root/bot-circus/dispatch.mjs';

export async function run(document) {
  // 1. Fan out to 5 specialists in parallel
  const specialists = [
    'agent-redteam-cfo',
    'agent-redteam-market',
    'agent-redteam-legal',
    'agent-redteam-competitor',
    'agent-redteam-execution',
  ];

  const results = await dispatchAll(specialists, specialists.map(id => document));

  // 2. Check for failures
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.warn(`⚠️ ${failed.length}/${specialists.length} specialists failed`);
  }

  // 3. Aggregate outputs for synthesis
  const combined = results
    .filter(r => r.ok)
    .map((r, i) => `=== ${specialists[i].toUpperCase()} ===\n${r.result}`)
    .join('\n\n');

  // 4. Run synthesis
  const synthesis = await dispatch('agent-redteam-synthesis', combined);

  return JSON.parse(synthesis);
}
```

### Benefits

- **Parallel execution:** 5 specialists run simultaneously (same speed as Python asyncio.gather)
- **Granular timeout:** Each specialist has 120s; synthesis has 60s
- **Partial results:** If 1 specialist fails, synthesis can still run on 4 outputs
- **Easier debugging:** Each sub-agent has its own SOUL.md and logs

### Drawbacks

- **More directories:** 10 packs × 6 avg performers = 60 performer dirs (vs 10 today)
- **Orchestrator complexity:** Each pack needs a bot.mjs orchestrator (not just SOUL.md)
- **Harder to modify:** Changing a pack means editing N+1 files instead of 1 SOUL.md

## When to Migrate to v2

Trigger conditions:

1. **240s timeout proves insufficient** for any pack (synthesis takes too long)
2. **User feedback:** "Python was faster, why is this slower?"
3. **Partial result demand:** "I want to see what CFO said even if Market timed out"
4. **Latency SLA:** If agent-bot becomes a paid product with <60s SLA

## Migration Path

1. **Pick one pack** (start with redteam — most complex, best test case)
2. **Create sub-performers:** agent-redteam-cfo/, agent-redteam-market/, etc.
3. **Write orchestrator:** agent-redteam/bot.mjs (see example above)
4. **Test end-to-end:** Ensure output matches v1 flattened version
5. **Benchmark:** Measure latency improvement (expect ~40-50% faster than v1)
6. **Migrate remaining packs** if benchmark justifies effort

## Not a Priority

v1 achieves the migration goal:

✅ Zero API credits consumed (Claude Max OAuth)  
✅ All 10 packs functional  
✅ Original prompts preserved verbatim  
✅ End-to-end tested (redteam, code_review, content, contract confirmed working)  

v2 is an **optimization**, not a necessity. Ship v1, monitor performance, upgrade if needed.

## Reference

- Python orchestrators: `/root/hydrabot/agents.legacy/*/orchestrator.py`
- dispatchAll implementation: `/root/bot-circus/dispatch.mjs:171-182`
- Current flattened SOUL.md: `/root/bot-circus/performers/agent-redteam/SOUL.md`
