# TOOLS.md - Tool Notes & Quick Reference

## Deploy Log Database

**File:** `data/deploy-log.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE deploys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL, -- 'whatsauction' or 'relay' or 'recon' or 'flashvault'
  version TEXT NOT NULL, -- 'v1.2.3'
  commit_sha TEXT NOT NULL,
  pre_flight_passed INTEGER DEFAULT 0,
  deployed_at TIMESTAMP,
  health_gates_passed INTEGER DEFAULT 0,
  rolled_back INTEGER DEFAULT 0,
  rollback_reason TEXT,
  release_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Pre-Flight Checklists

Store in `data/checklists/`:
- `whatsauction-deploy.md`
- `relay-deploy.md`
- `recon-deploy.md`
- `flashvault-deploy.md`

Checklist format:
```markdown
# WhatsAuction Deploy Checklist

- [ ] git status clean
- [ ] npm test passes
- [ ] .env.production exists
- [ ] DB migrations tested in staging
- [ ] DB backup created
- [ ] Rollback plan documented
```

## PM2 Deploy

```bash
cd /root/whatsauction
git pull origin main
npm install
pm2 reload whatsauction-api --update-env
pm2 reload whatsapp-worker --update-env
```

## Docker Deploy

```bash
cd /root/recon
git pull origin main
docker-compose down
docker-compose up -d --build
docker ps  # verify containers running
```

## Health Check Endpoints

- WhatsAuction: `curl -sf http://localhost:4000/health | jq .status`
- Relay: `curl -sf http://localhost:3030/health | jq .status`
- Recon: `curl -sf https://recon.whatshubb.co.za/api/health | jq .status`
- FlashVault: `curl -sf http://localhost:8080/health | jq .status`

## Smoke Tests

**WhatsAuction:**
```bash
# Test bid flow
curl -s -X POST http://localhost:4000/api/bids \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lotId":1,"amount":100}'
```

**Relay:**
```bash
# Test log defect
curl -s -X POST http://localhost:3030/tools/log_defect \
  -H "Content-Type: application/json" \
  -d '{"description":"test","severity":"low"}'
```

## Rollback

```bash
# Git rollback
cd /root/whatsauction
git log --oneline -n 5  # find previous commit
git revert <commit-sha>
pm2 reload whatsauction-api

# Docker rollback
docker-compose down
git checkout v1.2.2  # previous version
docker-compose up -d --build
```

## Release Notes

Auto-generate from git commits:
```bash
git log v1.2.2..v1.2.3 --oneline --pretty=format:"- %s"
```

Store in `data/release-notes/v1.2.3.md`.
