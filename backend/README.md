# Backend — Azure Functions

## Local run
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp local.settings.json.example local.settings.json   # fill in real values
func start
```

## Connect LinkedIn (one-time)
Visit `http://localhost:7071/api/auth/start`, approve the consent screen.
Tokens get saved to the `AuthTokens` table automatically.

## Test creating a post
```bash
curl -X POST http://localhost:7071/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "scheduled_date": "2026-08-10",
    "scheduled_time": "09:00",
    "topic": "Launch announcement",
    "copy_text": "Excited to share ...",
    "status": "scheduled"
  }'
```

## List a month's posts
```bash
curl http://localhost:7071/api/posts/2026-08
```

## Upload an image for a post
```bash
curl -X POST http://localhost:7071/api/posts/2026-08/<post_id>/image \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/image.jpg
```

## Publish / cancel a post
There's no auto-scheduler — LinkedIn's public API has no "publish at a future
time" parameter, so scheduling is a calendar convenience only. You publish by
calling this when ready (or clicking "Publish Now" in the UI):
```bash
curl -X POST http://localhost:7071/api/posts/2026-08/<post_id>/publish
```

To cancel a scheduled post (reverts it to draft):
```bash
curl -X POST http://localhost:7071/api/posts/2026-08/<post_id>/cancel
```

## Notes / known gaps to fill in as you iterate
- `LINKEDIN_VERSION` in `shared/linkedin_auth.py` should be checked against
  LinkedIn's current API version docs before going live — it's a guess/placeholder
  based on the "YYYYMM" convention LinkedIn uses.
- Routes are anonymous-auth since the Static Web App linkage handles trust for
  browser calls — don't expose this Function App's URL publicly without adding
  auth if you ever call it from anywhere else.
- No retry/notification on publish failure — a failed "Publish Now" just shows
  the error in the UI; nothing alerts you if you don't check back.
