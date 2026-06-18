# WIRE-UP.md — Scribe Installation

Scribe is a CLI tool (not a service). Invoked manually by owner.

## 1. Install dependencies

```bash
cd /root/bot-circus/performers/scribe
npm install
```

## 2. Symlink to system path

```bash
chmod +x /root/bot-circus/performers/scribe/cli.mjs
ln -sf /root/bot-circus/performers/scribe/cli.mjs /usr/local/bin/scribe
```

## 3. Verify ANTHROPIC_API_KEY

Scribe reads `ANTHROPIC_API_KEY` from:
1. `process.env.ANTHROPIC_API_KEY` (if set)
2. `/root/hydra-note/.env` (fallback via dotenv)

No need to create new credentials. Existing key is used.

## 4. Test it

```bash
# Show help
scribe help

# Run tests (no LLM calls, just smoke tests)
npm test

# Draft a LinkedIn post (this WILL call LLM and cost ~$0.15)
scribe linkedin "Capitec Pulse AI launch impact on banking UX"

# List drafts
scribe drafts

# Show a specific draft
scribe show 2026-05-31_capitec-pulse-ai_linkedin
```

## 5. Edit and publish manually

Drafts are saved to `/root/bot-circus/performers/scribe/drafts/YYYY-MM-DD_<slug>_<format>.md`

Open in your editor, tweak as needed, then manually copy/paste to LinkedIn/Twitter/blog.

Scribe NEVER auto-publishes. All output is draft markdown for human review.

## 6. Usage patterns

```bash
# LinkedIn post
scribe linkedin "Topic here"

# Blog post (includes hero image suggestion + tweet-thread version)
scribe blog "Topic here"

# Twitter thread
scribe thread "Topic here"

# Event recap
scribe recap "BD hackathon May 25-31"

# With options
scribe linkedin "Topic" --style technical --length short

# Recon integration (stub for now)
scribe linkedin "Capitec analysis" --with-recon capitecbank.co.za
```

## 7. Future integrations

- **Friday bot**: `/scribe linkedin <topic>` in Telegram routes to Scribe CLI, returns draft
- **Recon integration**: `--with-recon <company>` fetches a Recon report first, feeds data to LLM
- **Auto-publish webhook**: Optional opt-in for trusted drafts (NOT default behaviour)

## 8. Voice tuning

All voice rules live in `/root/bot-circus/performers/scribe/prompts/voice-guide.md`

Edit that file to adjust Kobus's voice. It's prepended to every system prompt.

## 9. Cost tracking

Every LLM call is logged to `/root/bot-circus/performers/scribe/usage.jsonl`

Check with:

```bash
cat /root/bot-circus/performers/scribe/usage.jsonl | jq -s 'map(.cost_usd | tonumber) | add'
```

## 10. No PM2, no Telegram bot, no auto-start

Scribe is invoked manually. No background process. No auto-publish. CLI only.
