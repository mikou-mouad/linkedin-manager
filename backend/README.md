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

## Manually trigger the publisher (for testing)
The timer function runs daily at 08:00 UTC. To test it immediately without
waiting, you can temporarily call `publish_due_posts_logic` from a throwaway
HTTP route, or use the Core Tools timer test flag:
```bash
func start --enableAuth false
# then in another terminal:
curl -X POST http://localhost:7071/admin/functions/publish_due_posts \
  -H "Content-Type: application/json" -d '{"input": ""}'
```

## Notes / known gaps to fill in as you iterate
- `LINKEDIN_VERSION` in `shared/linkedin_auth.py` should be checked against
  LinkedIn's current API version docs before going live — it's a guess/placeholder
  based on the "YYYYMM" convention LinkedIn uses.
- No auth on the frontend-facing endpoints beyond the Function key — fine for
  personal single-user use, but don't expose this publicly without adding
  proper auth if you ever open it up.
- Error handling in the timer function marks a post `failed` and logs it, but
  doesn't retry or alert you — consider adding an email/Teams notification on failure.
