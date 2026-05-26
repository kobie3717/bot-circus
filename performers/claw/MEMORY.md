# Claw — Worker Memory

*Shared brain for all ephemeral sub-workers. Write findings here; next worker will read them.*

## Seeded Knowledge (from AI-IQ)

- WhatsHubb ecosystem verticals: (1) WhatsLocal - INFORMAL sales (spazas, hawkers, food vendors, street traders), (2) WhatsSales - FORMAL sales (registered businesses, shops, online stores), (3) WhatsBooking - FORMAL service bookings/appointments (salons, mechanics, doctors, etc.), (4) WhatsAuction - auctioneers both FORMAL and INFORMAL (livestock, vehicles, household, art). All share: same map UI, same user accounts, same WhatsApp integration (Baileys), same payment gateways (SoftyComp, etc). Entry point: WhatsHubb (domain TBD). --project WhatsUniverse --tags architecture,vision,map --priority 9
- WhatsAuction uses Baileys (self-hosted) for WhatsApp group integration, NOT Meta Cloud API
- Domains (all on 45.10.161.148):
- PRIMARY (.co.za): app.whatsauction.co.za (frontend, /var/www/whatsauction-app/), api.whatsauction.co.za (backend API, Docker port 4000), www.whatsauction.co.za / whatsauction.co.za (landing, /var/www/flashfault), gateway.whatsauction.co.za (gateway proxy, port 18789), analytics.whatsauction.co.za (SSL only), n8n.whatsauction.co.za (SSL only).
- SECONDARY (.com): app.whatsauction.com (alt app, same /var/www/whatsauction-app/), api.whatsauction.com (in CORS), www.whatsauction.com / whatsauction.com (alt landing, /var/www/whatsauction-com/).
- LEGACY: auction.flashfault.co.za, flashfault.co.za (old domains, migration pending).
- EMAIL: whatsauction@whatsauction.co.za (SMTP), hello@, noreply@, billing@, admin@ @whatsauction.co.za.
- Nginx configs: 5 in /etc/nginx/sites-available/. SSL: 10 Let's Encrypt certs. --project WhatsAuction --tags domains,infrastructure --key whatsauction-domains
- WhatsAuction releases: v0.1.3 through v0.2.4 (11 releases). Latest v0.2.4 (2026-03-10). Sprint 1-3 completed: security hardening (JWT fallback removed, helmet, DOMPurify XSS), Telegram deploy notifications, npm dep fixes, Settings.tsx split (4328→343 lines), any type reduction (159→56), console.log cleanup, Terms of Service + Privacy Policy rewrite. --project WhatsAuction --tags releases,sprints
- WhatsAuction timeline: Nov 2025 XRPL arb bot (abandoned, spreads too thin). Dec 2025 FlashVault VPN + WhatsAuction born (first prompt: 'senior full-stack engineer helping build MVP called WhatsAuction'). Jan 2026 heavy dev (CI/CD, live console, auction types, invoices, scaling). Feb 2026 OpenClaw integration (Claw born Feb 5), domain migration flashfault→whatsauction.co.za, Baileys PRs started. Mar 2026 international launch, Claude Max x20, OAuth proxy, multi-persona system.
- Status: Production-ready, 470+ endpoints, 39 Prisma models, 44 route files, 41 services, multi-tenant architecture. Backend healthy (18h uptime), WhatsApp connected (10 orgs).
- WhatsAuction backend uses Prisma ORM for database with full type safety and migrations
- ✅ Invoicing: Multi-lot generation, payment tracking (PENDING/SENT/PAID/OVERDUE), auto-reminders, PDF generation
- Kobus is working with Baileys to build WhatsAuction messaging features
- Communication: AuctionMessage, NotificationPreference
- WhatsBookings (/root/whatsbookings/): Multi-tenant booking SaaS. Stack: Next.js 16 + Prisma + PostgreSQL + Baileys + BullMQ + Redis 8.6.1 + Docker. Domain: whatsbookings.co.za. GitHub: kobie3717/whatsbooking. DB: bodyfit. Redis: localhost:6379 (auth). Ports: 4008 (app), 4009 (WA service). Features: multi-tenant subdomain + custom domains, dual auth (admin JWT + portal OTP), admin dashboard (week calendar with book-for-client + block-time, live clock, paginated bookings), Google Calendar sync, WA notifications (PDF invoices via BullMQ), credits/package system, portal (dashboard, bookings, packages purchase EFT, invoices with cancel, health screening), post-payment (pay later with statement), change password. Infrastructure: Zod validation, Redis caching (5min TTL), fail-closed rate limiting, BullMQ async PDF, CORS, pino logging, anti-ban WA throttle, daily DB backup. Payment drivers: Yoco, PayFast, Ozow, Paystack (factory + admin settings UI). CI/CD: GitHub Actions. 74 tests. UltraScan: 8.8/10. Branch: feat/purchase-first-booking-flow. Orgs: BodyFitStudio, Gym bunny. --project WhatsBookings --tags booking,baileys,nextjs,docker,saas,redis,bullmq --key whatsbookings-project
- WhatsAuction frontend: cd /root/whatsauction/frontend && npm run build && pm2 restart whatsauction-web
- ✅ Auction Management: LIVE/TIMED/SILENT types, anti-sniping, auto-start, lot state machine, Buy Now, templates
- PostgreSQL handles all WhatsAuction data with excellent performance
- Subscription plans: STARTER (R0/free), PRO (R299/mo or R2870/yr), BUSINESS (R799/mo or R7670/yr). PayFast production mode.

## Live Session Notes


## [2026-05-16T11:18:56.750Z] Worker Result
Software engineering, architecture, debugging, and code review.
