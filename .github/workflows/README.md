# RSS feed health check

`rss-health-check.yml` monitors the theaiminute.blog RSS feed on a schedule and
alerts you when it breaks — so you find out the ingestion pipeline stalled from
an email, not from a reader.

## What it checks

Every 4 hours (and on manual runs) the workflow runs
`.github/scripts/check_rss.py`, which fails on the first of these problems:

1. **Reachability** — the feed URL does not return HTTP 200.
2. **Validity** — the response is not well-formed XML, or has no `<item>` /
   `<entry>` elements.
3. **Freshness** — the newest item is older than `MAX_AGE_HOURS` (default 48).
   A valid-but-stale feed is the usual signature of a silently stalled pipeline.

On failure the job exits non-zero. That alone triggers GitHub's built-in
"workflow failed" email to the repo admins. If you also configure SMTP secrets
(below), you additionally get a detailed alert email with the full report.

## Configuration

All settings are optional and have sensible defaults. Set them under
**Settings → Secrets and variables → Actions**.

### Repository variables (the *Variables* tab)

| Variable            | Default                             | Purpose                                              |
| ------------------- | ----------------------------------- | ---------------------------------------------------- |
| `RSS_FEED_URL`      | `https://theaiminute.blog/rss.xml`  | The feed to monitor. **Verify this points at the real feed** before relying on the schedule. |
| `RSS_MAX_AGE_HOURS` | `48`                                | Max age of the newest item before it counts as stale. Set to `0` to disable the freshness check. |
| `ALERT_EMAIL`       | falls back to `MAIL_USERNAME`       | Where alert emails are sent.                         |

### Repository secrets (the *Secrets* tab) — needed only for custom email

| Secret          | Purpose                                                            |
| --------------- | ----------------------------------------------------------------- |
| `MAIL_USERNAME` | Gmail address the alert is sent **from** (and, by default, **to**). |
| `MAIL_PASSWORD` | A Gmail **App Password** (not your normal password).              |

To create a Gmail App Password: enable 2-Step Verification on the Google
account, then visit **Google Account → Security → App passwords** and generate
one for "Mail". Paste the 16-character value into `MAIL_PASSWORD`.

If these secrets are absent, the email step is skipped automatically and you
rely on GitHub's native failure notification instead — nothing errors.

## Testing it

1. Push this branch and open the repo's **Actions** tab.
2. Select **RSS feed health check → Run workflow** to trigger a manual run.
3. Open the run and read the **Summary** — it shows the full health report
   (HTTP status, item count, newest-item age).
4. To confirm alerting end to end, temporarily set `RSS_FEED_URL` to a URL that
   404s (or `RSS_MAX_AGE_HOURS` to `1`), run again, and check that the job fails
   and the email arrives. Restore the value afterward.

## Adjusting the schedule

Edit the `cron` line in `rss-health-check.yml`. Cron runs in UTC. Examples:

- `0 */4 * * *` — every 4 hours (current).
- `0 */2 * * *` — every 2 hours.
- `0 8 * * *` — once daily at 08:00 UTC.
