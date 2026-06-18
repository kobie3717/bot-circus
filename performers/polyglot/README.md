# Polyglot 🌍

Translation specialist CLI for SA + Mediterranean languages. Idiomatic, register-aware, preserves technical terms.

## Quick Start

```bash
polyglot translate "Goeie môre kaptein" --to en
# Output: Good morning captain
```

## Supported Languages

**South African:** en, af, zu  
**Mediterranean:** es, it, fr, de, pt, nl

## Key Features

- Auto-detect source language
- Register matching (formal, casual, whatsapp)
- Preserve marine/tech terms (STCW, AIS, bilge, API, SaaS)
- Idiomatic translation (not literal)
- Cost tracking ($0.80/MTok in, $4/MTok out)

## Commands

```bash
polyglot translate <text> --to <lang>              # Translate text
polyglot translate <text> --to es --register formal # Formal register
polyglot translate-file README.md --to es          # Translate file
polyglot detect "Hola capitán"                     # Detect language
polyglot languages                                 # List supported languages
```

## Cost

Avg translation: ~$0.001-0.003 USD  
View total: `cat usage.jsonl | jq -s 'map(.cost_usd) | add'`

## Installation

See [WIRE-UP.md](./WIRE-UP.md) for full setup instructions.

## Model

Claude Haiku 4.5 (claude-haiku-4-5-20251001) — fast, cheap, native multilingual.
