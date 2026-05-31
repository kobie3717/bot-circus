# Friday — Worker Memory

*Shared brain for all ephemeral sub-workers. Write findings here; next worker will read them.*

**Structure upgraded to Octo gold standard on 2026-05-31.**
*Archived old detailed logs to memory/archive-2026-05-31.md*

---

## Core Knowledge

**Friday Identity:**
- Agent ID: friday-174577
- Telegram: @friday_assistant_bot
- Runtime: Custom bot.mjs (57KB) with grammy long-poll
- Siblings: Octo (/root/octo-workspace), Claw (/root/.openclaw/workspace)
- Circus: http://localhost:6200

**Owner: Kobus (Hannes)**
- Location: South Africa (SAST, UTC+2)
- Family: Wife, 5 kids — protect his time
- Style: Casual, direct, show results
- Contact: Telegram @Theclawbotbot, WhatsApp +27825651069

---

## Active Projects

**WhatsAuction** — Main priority
- Port 4000, PM2: whatsauction-api + whatsapp-worker
- DB: PostgreSQL (vpn_user/vpn_secure_password_2025)
- Goal: 10 paying customers by Apr 2026
- Status: Live, actively onboarding

**Relay AI / hydra-note** — Yacht agency SaaS
- Port 3030, PM2: relay-ai
- WaSP multi-tenant sessions
- Customer: Matt Bullamore
- Status: Production, PM2 stable

**Memzy** — Event social wall
- Port 4040
- WhatsApp Baileys integration
- Use case: School fests, weddings
- Status: Production-ready, E-E-A-T work outstanding
- Archive: Full event checklist in memory/archive-2026-05-31.md

**Recon** — BD competitive intel (May 25-31 hackathon)
- 10 modes, agentic loop 15s
- Live: recon.whatshubb.co.za
- Status: Complete, demo-ready

**FlashVault** — VPN service
- Secondary priority
- Status: Stable

---

## Key Learnings

**WhatsAuction i18n completed:**
- All pages translated (Invoices, Home, Bidders)
- Days 1-3 built and working
- One-click settle feature planned (v1 no approval workflow)

**Circus Mesh Integration:**
- Shared knowledge bridge deployed to all 3 bots
- 7 shared knowledge tests passing
- Auto-memory, preference detection, correction signals working

**Claw Session Management:**
- Old sessions can get stale (46+ message history)
- Clear session if getting 1-char responses (409 errors)
- AutoClaw runs every 5 min — can trigger simultaneous bot restarts

**Friday Capabilities:**
- Email: IMAP/SMTP via Zoho (email-reader.mjs, email-sender.mjs)
- Voice: Whisper transcription (voice.mjs)
- Inbox: Centralized aggregator (inbox.mjs)
- Dashboards: fullDashboard(), serverDashboard()
- Actions: Predefined server ops (actions.mjs)
- Circus: Full mesh integration (circus-bridge.mjs 46KB)

---

## Disabled Services (DO NOT ALERT)

- claw-whatsapp (port 7700) — STOPPED intentionally
- claw-email (port 7701) — STOPPED intentionally
- claw-monitor — STOPPED intentionally

---

## File Locations

- **Friday runtime:** /root/bot-circus/performers/friday/
- **Friday workspace (legacy):** /root/friday-workspace/
- **WhatsAuction:** /root/whatsauction/
- **Reference docs:** /root/.openclaw/reference/
- **Credentials:** /root/.openclaw/credentials/
- **Circus identity:** /root/.circus/friday-identity.json

---

## Live Session Notes

*(Use this section for ephemeral in-session findings)*
