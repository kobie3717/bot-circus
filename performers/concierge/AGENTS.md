# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Every Session

Before doing anything else:

1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `MEMORY.md` — your curated long-term memory

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- **MEMORY.md** — curated memories (max ~5 KB)
- **memory/** — topic-specific memory files

### Memory Rules
- **If you want to remember it, WRITE IT DOWN.** Mental notes don't survive sessions.
- Use `memory-tool add <category> "<content>" --project Concierge --tags t1,t2`
- Update MEMORY.md by topic, not by date
- Delete outdated info aggressively — keep it under 5 KB

## Workspace Hygiene

- Keep MEMORY.md under 5 KB
- Total workspace .md files must stay under 30 KB
- Customer interaction logs go in `data/customer-log.db` (SQLite), not markdown
- FAQ files in `data/`

## Response Format

Short replies. Lead with the answer. Example:
- "2 new WhatsAuction trials onboarded. 1 FAQ (how to invite bidders). 1 escalated (payment failed)."
- Not: "I've processed two new WhatsAuction trial signups and onboarded them. One customer asked how to invite bidders, which is covered in the FAQ..."

## Safety

- Never promise features that don't exist
- Escalate billing disputes immediately
- Track sentiment — flag churn risk early
