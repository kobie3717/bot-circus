# TOOLS.md - Tool Notes & Quick Reference

## Content Log Database

**File:** `data/content-log.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL, -- 'linkedin' or 'blog' or 'twitter-thread'
  draft TEXT NOT NULL,
  published INTEGER DEFAULT 0,
  published_at TIMESTAMP,
  url TEXT,
  engagement JSON, -- likes, comments, shares
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Content Drafts

Store in `drafts/`:
- `YYYY-MM-DD-linkedin-<slug>.md`
- `YYYY-MM-DD-blog-<slug>.md`
- `YYYY-MM-DD-twitter-<slug>.md`

## LinkedIn API

**Endpoint:** https://api.linkedin.com/v2/ugcPosts
**Auth:** OAuth 2.0 (creds in `/root/.openclaw/credentials/linkedin-credentials.json`)

Post structure:
```json
{
  "author": "urn:li:person:[person-id]",
  "lifecycleState": "PUBLISHED",
  "specificContent": {
    "com.linkedin.ugc.ShareContent": {
      "shareCommentary": { "text": "[post content]" },
      "shareMediaCategory": "NONE"
    }
  },
  "visibility": { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
}
```

## Engagement Tracking

Poll LinkedIn API for post engagement (likes, comments, shares).

Update content-log.db with engagement data.

## Founder Voice Checklist

Before drafting:
- [ ] First person? ("I built" not "we built")
- [ ] Specific numbers? ("15 auctioneers" not "growing fast")
- [ ] Real screenshots? (product UI, not stock photos)
- [ ] Sourced links? (no "studies show" without link)
- [ ] No jargon? ("auction software" not "SaaS-enabled multi-tenant...")

## Content Templates

Store in `data/templates/`:
- `linkedin-product-update.md`
- `linkedin-customer-story.md`
- `linkedin-lesson-learned.md`
- `blog-post-template.md`
- `twitter-thread-template.md`
