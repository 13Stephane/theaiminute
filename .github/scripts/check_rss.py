#!/usr/bin/env python3
"""Health check for the theaiminute.blog RSS feed.

Verifies three things, in order, and fails (exit code 1) on the first problem:

  1. Reachability   - the feed URL returns HTTP 200.
  2. Validity       - the response is well-formed XML with at least one
                      item/entry (RSS 2.0 or Atom).
  3. Freshness      - the most recent item is newer than MAX_AGE_HOURS.
                      A valid-but-stale feed is the tell-tale sign that the
                      upstream ingestion pipeline has silently stalled, so we
                      treat it as a failure worth alerting on.

Configuration (environment variables):
  FEED_URL       Feed to check. Default: https://theaiminute.blog/rss.xml
  MAX_AGE_HOURS  Max age of the newest item before it counts as stale.
                 Default: 48. Set to 0 to disable the freshness check.

The script prints a human-readable report to stdout regardless of outcome;
the calling workflow forwards that report into the alert email and the run
summary.
"""

import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

FEED_URL = os.environ.get("FEED_URL", "https://theaiminute.blog/rss.xml").strip()
try:
    MAX_AGE_HOURS = float(os.environ.get("MAX_AGE_HOURS", "48").strip() or "48")
except ValueError:
    MAX_AGE_HOURS = 48.0

# Element local-names (namespace stripped) that carry an item/entry timestamp.
DATE_TAGS = {"pubdate", "published", "updated", "date"}
ITEM_TAGS = {"item", "entry"}
USER_AGENT = "theaiminute-rss-healthcheck/1.0 (+https://theaiminute.blog)"
TIMEOUT_SECONDS = 30


def localname(tag: str) -> str:
    """Return an element's tag without its XML namespace, lower-cased."""
    return tag.rsplit("}", 1)[-1].lower()


def parse_date(text: str):
    """Parse an RSS (RFC 822) or Atom (ISO 8601) date. Return aware UTC datetime or None."""
    if not text:
        return None
    text = text.strip()

    # Try RFC 822 first (RSS <pubDate>, e.g. "Tue, 05 Aug 2026 06:00:00 +0000").
    try:
        dt = parsedate_to_datetime(text)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass

    # Fall back to ISO 8601 (Atom <updated>/<published>, e.g. "2026-08-05T06:00:00Z").
    iso = text.replace("Z", "+00:00") if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def fail(report_lines, reason):
    report_lines.append("")
    report_lines.append(f"RESULT: FAIL — {reason}")
    print("\n".join(report_lines))
    sys.exit(1)


def ok(report_lines, note):
    report_lines.append("")
    report_lines.append(f"RESULT: OK — {note}")
    print("\n".join(report_lines))
    sys.exit(0)


def main():
    now = datetime.now(timezone.utc)
    report = [
        "The AI Minute — RSS feed health check",
        f"Feed:        {FEED_URL}",
        f"Checked at:  {now.isoformat()}",
        f"Max age:     {MAX_AGE_HOURS:g} h" if MAX_AGE_HOURS > 0 else "Max age:     (freshness check disabled)",
    ]

    if not FEED_URL:
        fail(report, "FEED_URL is empty. Set the RSS_FEED_URL repository variable.")

    # 1. Reachability -------------------------------------------------------
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.getcode()
            body = response.read()
    except urllib.error.HTTPError as exc:
        fail(report, f"feed returned HTTP {exc.code} {exc.reason}.")
    except urllib.error.URLError as exc:
        fail(report, f"feed is unreachable ({exc.reason}).")
    except Exception as exc:  # noqa: BLE001 - surface any unexpected fetch error
        fail(report, f"unexpected error fetching feed: {exc}.")

    report.append(f"HTTP status: {status}")
    report.append(f"Bytes:       {len(body)}")
    if status != 200:
        fail(report, f"expected HTTP 200 but got {status}.")

    # 2. Validity -----------------------------------------------------------
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError as exc:
        fail(report, f"feed is not well-formed XML ({exc}).")

    items = [el for el in root.iter() if localname(el.tag) in ITEM_TAGS]
    report.append(f"Items found: {len(items)}")
    if not items:
        fail(report, "feed parsed but contains no <item>/<entry> elements.")

    # 3. Freshness ----------------------------------------------------------
    dates = []
    for el in root.iter():
        if localname(el.tag) in DATE_TAGS and el.text:
            parsed = parse_date(el.text)
            if parsed is not None:
                dates.append(parsed)

    if not dates:
        report.append("Latest item: (no parseable dates found)")
        if MAX_AGE_HOURS > 0:
            fail(report, "no item date could be parsed, so freshness cannot be confirmed.")
        ok(report, "feed reachable and valid (freshness check disabled).")

    latest = max(dates)
    age_hours = (now - latest).total_seconds() / 3600.0
    report.append(f"Latest item: {latest.isoformat()} ({age_hours:.1f} h ago)")

    if MAX_AGE_HOURS > 0 and age_hours > MAX_AGE_HOURS:
        fail(
            report,
            f"newest item is {age_hours:.1f} h old, exceeding the {MAX_AGE_HOURS:g} h limit. "
            "The ingestion pipeline may have stalled.",
        )

    ok(report, f"feed reachable, valid, and fresh ({len(items)} items, newest {age_hours:.1f} h ago).")


if __name__ == "__main__":
    main()
