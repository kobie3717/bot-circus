# TOOLS.md - Tool Notes & Quick Reference

## Voice Log Database

**File:** `data/voice-log.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE voice_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL, -- 'inbound' or 'outbound'
  transcript TEXT NOT NULL,
  tone TEXT, -- 'frustrated' or 'excited' or 'urgent' or 'casual' or 'formal'
  summary TEXT,
  audio_file TEXT, -- path to audio file (deleted after processing)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Whisper API (OpenAI)

**Endpoint:** https://api.openai.com/v1/audio/transcriptions
**Auth:** Bearer token (creds in `/root/.openclaw/credentials/openai-credentials.json`)

Transcription:
```bash
curl https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F file="@/path/to/audio.mp3" \
  -F model="whisper-1"
```

## ElevenLabs API

**Endpoint:** https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
**Auth:** xi-api-key (creds in `/root/.openclaw/credentials/elevenlabs-credentials.json`)

Voice synthesis (Bella voice):
```bash
curl -X POST https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, this is Echo","model_id":"eleven_monolingual_v1"}' \
  --output audio.mp3
```

Voice IDs:
- Bella: `EXAVITQu4vr4xnSDxMaL` (default — warm, professional, SA-neutral)
- Rachel: `21m00Tcm4TlvDq8ikWAM` (US)
- Antoni: `ErXwobaYiN019PkySvjV` (British)
- Elli: `MF3mGyEYCl7XYWbV9V6O` (casual)

## Audio Extraction (from video)

Use `ffmpeg` to extract audio from video files:
```bash
ffmpeg -i video.mp4 -vn -acodec libmp3lame audio.mp3
```

## Tone Detection

Keywords:
- Frustrated: "not working", "still waiting", "this is ridiculous"
- Excited: "amazing", "love it", "can't wait"
- Urgent: "ASAP", "immediately", "emergency"
- Casual: "hey", "just checking", "no rush"
- Formal: "regarding", "kindly", "at your earliest convenience"

## Call Summary Template

```
Call summary: [Who called] re: [what they wanted]. [Action needed]. Tone: [tone].

Transcript:
[full transcript]
```
