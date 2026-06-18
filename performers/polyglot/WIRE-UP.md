# Polyglot Wire-Up

## Installation

```bash
# 1. Install dependencies
cd /root/bot-circus/performers/polyglot
npm install

# 2. Create symlink for global CLI access
chmod +x cli.mjs
ln -sf /root/bot-circus/performers/polyglot/cli.mjs /usr/local/bin/polyglot

# 3. Verify ANTHROPIC_API_KEY is loaded
grep ANTHROPIC_API_KEY /root/hydra-note/.env
# Should show: ANTHROPIC_API_KEY=sk-ant-api03-...

# 4. Test installation
polyglot --version  # Should not error
polyglot languages  # Should list supported languages (no LLM call)
```

## Usage Examples

### Basic Translation
```bash
# Auto-detect source language, translate to English
polyglot translate "Goeie môre kaptein" --to en

# Expected output:
# Good morning captain
```

### Explicit Source Language
```bash
# Spanish to English, casual register
polyglot translate "Hola, ¿cómo está el bilge?" --to en --from es --register casual

# Expected output:
# Hey, how's the bilge doing?
```

### Formal Register
```bash
# English to Spanish, formal business register
polyglot translate "Dear Sir, Please find attached the invoice." --to es --register formal

# Expected output:
# Estimado señor, Adjunto encontrará la factura.
```

### WhatsApp Register
```bash
# Afrikaans to English, WhatsApp casual
polyglot translate "Ja bru, kom ons braai" --to en --register whatsapp

# Expected output:
# Yeah bro, let's braai
```

### File Translation
```bash
# Translate entire markdown file
polyglot translate-file ./README.md --to es

# Output: README.es.md
```

### Language Detection Only
```bash
polyglot detect "Hola, capitán"

# Expected output:
# es
```

### Save Translation with Metadata
```bash
polyglot translate "The bilge pump is broken" --to es --save

# Saves to: translations/2026-05-31_the_bilge_pump_is_broken_en_to_es.md
```

## Cost Tracking

View total cost of all translations:
```bash
cat /root/bot-circus/performers/polyglot/usage.jsonl | jq -s 'map(.cost_usd) | add'
```

View last 10 translations:
```bash
tail -10 /root/bot-circus/performers/polyglot/usage.jsonl | jq
```

## Technical Terms Preserved

Marine, business, and product terms stay in English regardless of target language:
- Marine: STCW, AIS, bilge, winch, bowsprit, spinnaker, MARPOL, GMDSS
- Business: API, SaaS, MVP, B2B, KPI, MRR, ARR
- Products: WhatsApp, Telegram, WhatsAuction, Relay, PredSea, Recon, Claude

## Supported Languages

**South African:**
- en (English)
- af (Afrikaans)
- zu (isiZulu)

**Mediterranean (for Relay yacht customers):**
- es (Spanish)
- it (Italian)
- fr (French)
- de (German)
- pt (Portuguese)
- nl (Dutch)

## Register Options

- `formal`: Business correspondence, contracts, invoices
- `casual`: Friendly conversation, relaxed tone
- `whatsapp`: Short, informal, common abbreviations

## Future Integration

Friday (Telegram bot) integration:
```bash
/translate <text> --to es
```

This will invoke Polyglot CLI and return the translation to Telegram.

## Troubleshooting

**Error: ANTHROPIC_API_KEY not found**
```bash
# Load .env manually
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY /root/hydra-note/.env | cut -d= -f2)
```

**Error: Command not found**
```bash
# Re-create symlink
ln -sf /root/bot-circus/performers/polyglot/cli.mjs /usr/local/bin/polyglot
```

**Translation quality issues**
- Check register matches intent (formal vs casual vs whatsapp)
- Verify source language detection is correct (use `polyglot detect` first)
- Some idioms don't translate cleanly — consider English phrasing for technical content

## Model Info

- Model: claude-haiku-4-5-20251001
- Pricing: $0.80/MTok input, $4.00/MTok output
- Max output: 2000 tokens per translation
- Avg cost per translation: ~$0.001-0.003 USD

---

**Manual Steps for Kobus:**

1. `cd /root/bot-circus/performers/polyglot && npm install`
2. `ln -sf /root/bot-circus/performers/polyglot/cli.mjs /usr/local/bin/polyglot`
3. Test: `polyglot languages`
4. First translation: `polyglot translate "Hoe gaan dit?" --to en`
5. Check cost: `cat usage.jsonl | jq -s 'map(.cost_usd) | add'`
