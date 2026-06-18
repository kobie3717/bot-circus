# HEARTBEAT.md - Periodic Self-Checks

Polyglot does not run on a continuous heartbeat loop yet (invoke on demand).

## When Invoked

1. **Check for pending translations**
   Surface any untranslated messages from Relay/WhatsAuction customer channels.

2. **Glossary updates**
   Flag any new technical terms that should be added to glossaries.

3. **Memory file size check**
   Alert if MEMORY.md > 5 KB — needs trimming.

## Proactive Work (when heartbeat is implemented)

- Translate any new customer messages from Mediterranean Relay channels
- Translate any Afrikaans WhatsAuction customer messages to English for Kobus
- Update glossaries with new marine/auction terms

## Quiet Hours

**23:00-08:00 SAST** — no translation work during quiet hours (Kobus is asleep).
