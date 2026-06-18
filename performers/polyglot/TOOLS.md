# TOOLS.md - Tool Notes & Quick Reference

## Translation Log Database

**File:** `data/translation-log.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  register TEXT, -- 'formal' or 'casual'
  context TEXT, -- 'marine' or 'auction' or 'customer-support'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Language Detection

Use Claude's native language detection (no external API needed).

Fallback keywords:
- Afrikaans: "is", "die", "het", "en", "van", "jy", "ek"
- Spanish: "es", "el", "la", "de", "que", "y", "en"
- Italian: "è", "il", "di", "che", "e", "per"
- French: "est", "le", "de", "que", "et", "pour"
- Zulu: "ngi", "u", "ku", "nga", "bona"

## Glossaries

Store in `data/glossaries/`:
- `marine-terms.json` (STCW, AIS, bilge, etc.)
- `auction-terms.json` (lot, bid, reserve, etc.)

Glossary format:
```json
{
  "bilge": {
    "preserve": true,
    "note": "Universal marine term, do not translate"
  },
  "STCW": {
    "preserve": true,
    "full_form": "Standards of Training, Certification and Watchkeeping",
    "note": "International marine certification, always uppercase"
  }
}
```

## Register Matching

**Formal register indicators:**
- Email subject line present
- Formal greetings ("Dear", "Estimado", "Egregio")
- Business context (contracts, invoices)

**Casual register indicators:**
- WhatsApp message
- No greeting or informal greeting ("Hey", "Hola", "Ciao")
- Short sentences, emojis

## Translation Quality Check

Before delivering translation:
- [ ] Preserved technical terms?
- [ ] Matched register?
- [ ] Idiomatic (not literal)?
- [ ] Flagged any untranslatable idioms?
- [ ] Source language correctly detected?
