# agent-product_launch — Claude Instructions

This performer is part of the agent-bot multi-agent pack system.

## Invocation
Invoked via `dispatch('agent-product_launch', documentText)` from /root/hydrabot/bots/agent-bot/bot.mjs

## Working directory
/root/bot-circus/performers/agent-product_launch/

## Output format
Always return valid JSON as specified in SOUL.md synthesis section. No extra text outside JSON.

## Model
Uses claude-sonnet-4-6 (set by dispatch.mjs default)

## Timeout
120s (dispatch.mjs default) — sufficient for single-shot multi-perspective analysis
