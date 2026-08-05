#!/usr/bin/env python3
"""Health check for The AI Minute's published content.

theaiminute.blog has no classic RSS feed — the site loads published posts live
from a Supabase REST endpoint. So "is the feed healthy?" really means "is the
blog still publishing?", which is the tell-tale sign of whether the upstream
RSS-ingestion pipeline is alive. This script checks exactly that.

It supports two source shapes and auto-detects which it got:

  * JSON  (Supabase / PostgREST) - an array of post objects. The check passes
          when the endpoint returns 200, the array is non-empty, and the newest
          post's date is within MAX_AGE_HOURS.
  * XML   (RSS 2.0 / Atom)       - kept so this still works if a real feed is
          added later.

The check fails (exit code 1) on the first problem: unreachable, non-200,
unparseable, empty, or stale. It prints a human-readable report to stdout
either way; the workflow forwards that into the run summary and alert email.

Configuration (environment variables):
  FEED_URL       Source to check. Default: the Supabase published-posts endpoint.
  MAX_AGE_HOURS  Max age of the newest item before it counts as stale.
                 Default: 72 (tolerates a weekend gap). 0 disables the check.
  API_KEY        Optional. If set, sent as both `apikey` and
                 `Authorization: Bearer <key>` headers — required by Supabase.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

DEFAULT_FEED = (
    "https://kcobpakjfluuyfzswtoq.supabase.co/rest/v1/posts"
    "?status=eq.published&order=published_at.desc&limit=5"
)

FEED_URL = os.environ.get("FEED_URL", DEFAULT_FEED).strip()
API_KEY = os.environ.get("API_KEY", "").strip()
try:
    MAX_AGE_HOURS = float(os.environ.get("MAX_AGE_HOURS", "72").strip() or "72")
except ValueError:
    MAX_AGE_HOURS = 72.0

# JSON post fields (in priority order) and XML element local-names that carry a
# timestamp; the first present/parseable one wins.
DATE_FIELDS = ("published_at", "created_at", "updated_at", "date", "pubDate")
DATE_TAGS = {"pubdate", "published", "updated", "date"}
ITEM_TAGS = {"item", "entry"}
USER_AGENT = "theaiminute-healthcheck/1.0 (+https://theaiminute.blog)"
TIMEOUT_SECONDS = 30


def localname(tag: str) -> str:
    """Return an element's tag without its XML namespace, lower-cased."""
    return tag.rsplit("}", 1)[-1].lower()


def parse_date(text):
    """Parse an RFC 822 (RSS) or ISO 8601 (Atom/PostgREST) date. Aware UTC or None."""
    if not text:
        return None
    text = str(text).strip()

    # RFC 822 first (RSS <pubDate>, e.g. "Tue, 05 Aug 2026 06:00:00 +0000").
    try:
        dt = parsedate_to_datetime(text)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass

    # ISO 8601 (Atom <updated>, PostgREST timestamps, e.g. "2026-08-05T06:00:00+00:00").
    iso = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def fail(report, reason):
    report.append("")
    report.append(f"RESULT: FAIL — {reason}")
    print("\n".join(report))
    sys.exit(1)


def ok(report, note):
    report.append("")
    report.append(f"RESULT: OK — {note}")
    print("\n".join(report))
    sys.exit(0)


def looks_like_json(body, content_type):
    if "json" in content_type.lower():
        return True
    head = body.lstrip()[:1]
    return head in (b"[", b"{")


def newest_from_json(report, body):
    """Return (item_count, newest_datetime_or_None); fail() on structural problems."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        fail(report, f"response is not valid JSON ({exc}).")

    if isinstance(data, dict):
        # PostgREST returns an object (not an array) for errors.
        message = data.get("message") or data.get("error") or str(data)[:200]
        fail(report, f"endpoint returned an error object: {message}")

    if not isinstance(data, list):
        fail(report, f"expected a JSON array of posts but got {type(data).__name__}.")

    report.append(f"Posts returned: {len(data)}")
    if not data:
        fail(report, "endpoint returned 200 but no published posts.")

    dates = []
    for item in data:
        if not isinstance(item, dict):
            continue
        for field in DATE_FIELDS:
            if item.get(field):
                parsed = parse_date(item[field])
                if parsed is not None:
                    dates.append(parsed)
                    break
    return len(data), (max(dates) if dates else None)


def newest_from_xml(report, body):
    """Return (item_count, newest_datetime_or_None); fail() on structural problems."""
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError as exc:
        fail(report, f"response is not well-formed XML ({exc}).")

    items = [el for el in root.iter() if localname(el.tag) in ITEM_TAGS]
    report.append(f"Items found: {len(items)}")
    if not items:
        fail(report, "feed parsed but contains no <item>/<entry> elements.")

    dates = []
    for el in root.iter():
        if localname(el.tag) in DATE_TAGS and el.text:
            parsed = parse_date(el.text)
            if parsed is not None:
                dates.append(parsed)
    return len(items), (max(dates) if dates else None)


def main():
    now = datetime.now(timezone.utc)
    report = [
        "The AI Minute — content health check",
        f"Source:      {FEED_URL}",
        f"Checked at:  {now.isoformat()}",
        (f"Max age:     {MAX_AGE_HOURS:g} h" if MAX_AGE_HOURS > 0
         else "Max age:     (freshness check disabled)"),
    ]

    if not FEED_URL:
        fail(report, "FEED_URL is empty. Set the RSS_FEED_URL repository variable.")

    # 1. Reachability -------------------------------------------------------
    headers = {"User-Agent": USER_AGENT}
    if API_KEY:
        headers["apikey"] = API_KEY
        headers["Authorization"] = f"Bearer {API_KEY}"
    request = urllib.request.Request(FEED_URL, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", None) or response.getcode()
            content_type = response.headers.get("Content-Type", "")
            body = response.read()
    except urllib.error.HTTPError as exc:
        fail(report, f"source returned HTTP {exc.code} {exc.reason}.")
    except urllib.error.URLError as exc:
        fail(report, f"source is unreachable ({exc.reason}).")
    except Exception as exc:  # noqa: BLE001 - surface any unexpected fetch error
        fail(report, f"unexpected error fetching source: {exc}.")

    report.append(f"HTTP status: {status}")
    report.append(f"Content-Type: {content_type or '(none)'}")
    report.append(f"Bytes:       {len(body)}")
    if status != 200:
        fail(report, f"expected HTTP 200 but got {status}.")

    # 2. Validity + 3. Freshness -------------------------------------------
    if looks_like_json(body, content_type):
        count, latest = newest_from_json(report, body)
    else:
        count, latest = newest_from_xml(report, body)

    if latest is None:
        report.append("Latest item: (no parseable dates found)")
        if MAX_AGE_HOURS > 0:
            fail(report, "no item date could be parsed, so freshness cannot be confirmed.")
        ok(report, f"source reachable and valid ({count} items; freshness check disabled).")

    age_hours = (now - latest).total_seconds() / 3600.0
    report.append(f"Latest item: {latest.isoformat()} ({age_hours:.1f} h ago)")

    if MAX_AGE_HOURS > 0 and age_hours > MAX_AGE_HOURS:
        fail(
            report,
            f"newest item is {age_hours:.1f} h old, exceeding the {MAX_AGE_HOURS:g} h limit. "
            "Publishing may have stalled.",
        )

    ok(report, f"reachable, valid, and fresh ({count} items, newest {age_hours:.1f} h ago).")


if __name__ == "__main__":
    main()
