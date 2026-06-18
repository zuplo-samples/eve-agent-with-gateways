---
cron: "0 9 * * 1"
---

Produce a weekly Buffer performance summary covering the last 7 days (from 7 days ago through today).

1. Call `get_account` for the organization, then `list_channels` to enumerate every channel.
2. For each channel, pull aggregated post metrics for that 7-day window.
3. Combine everything into ONE cross-channel summary:
   - Overall totals for the week across all channels.
   - A short per-channel breakdown.
   - Call out the best- and worst-performing channel and any notable change.

Keep it concise and skimmable. Use only the tools the `buffer` connection exposes; if a metric isn't available, say so rather than inventing numbers.
