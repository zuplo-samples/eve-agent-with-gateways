---
cron: "0 9 * * 1"
---

Produce a weekly Buffer activity summary covering the last 7 days (from 7 days ago through today).

1. Call `get_account` for the organization, then `list_channels` to enumerate every channel.
2. For each channel, use `list_posts` to gather the posts in that 7-day window.
3. Combine everything into ONE cross-channel summary:
   - Total posts published this week across all channels
   - A short per-channel breakdown (count + a one-line sense of what was posted).
   - Call out the most and least active channels and any notable change in cadence.

Keep it concise and skimmable. Use only the tools the `buffer` connection exposes and only the fields they return; do not call performance/insights metrics (not in scope) and never invent numbers — if something isn't available, say so.
