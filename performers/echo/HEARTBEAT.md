# HEARTBEAT.md - Periodic Self-Checks

Echo does not run on a continuous heartbeat loop yet (invoke on demand).

## When Invoked

1. **Check for pending voice messages**
   Surface any unprocessed voice messages from Telegram.

2. **Audio file cleanup**
   Delete audio files older than 7 days from `data/audio/` (privacy + disk space).

3. **Memory file size check**
   Alert if MEMORY.md > 5 KB — needs trimming.

## Proactive Work (when heartbeat is implemented)

- Transcribe any new voice messages from Kobus
- Summarize any phone call recordings
- Draft voice replies for Kobus review

## Quiet Hours

**23:00-08:00 SAST** — no voice processing during quiet hours (Kobus is asleep).
