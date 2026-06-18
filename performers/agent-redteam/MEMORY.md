# agent-redteam Memory

Created: 2026-05-27

Ported from Python Anthropic SDK implementation at /root/hydrabot/agents/redteam/

This performer runs multi-agent analysis via a flattened single-shot prompt combining all specialist perspectives.

## Original Python Structure
- Multiple specialist agents (4-6 per pack) running in parallel via asyncio.gather
- Synthesis agent aggregating results into JSON
- Total agents/pack: varied (redteam=6, code_review=5, etc.)

## Migration Notes
- Flattened all sub-agent prompts into a single SOUL.md
- Single dispatch call replaces Python orchestrator
- Original prompts preserved verbatim in SOUL.md sections
- Future enhancement: fan-out via dispatchAll for parallel sub-agent execution (see FUTURE.md)
