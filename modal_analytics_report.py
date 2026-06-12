"""
JP Training — Weekly Analytics Report
Runs every Monday at 9am UK time.

Pulls GA4 data for the past 7 days, sends it to Claude for analysis,
emails the report to jp@jptraining.fit via Web3Forms.

Deploy:
  /Users/jp/Library/Python/3.9/bin/modal deploy "/Users/jp/VS Code Workspace/jp-training/modal_analytics_report.py"

Secrets required in Modal:
  ga4-secret       → GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_JSON
  anthropic-secret → ANTHROPIC_API_KEY
"""

import modal

app = modal.App("jp-training-analytics")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "google-analytics-data",
        "google-auth",
        "anthropic",
        "requests",
    )
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def build_ga4_client(service_account_json: str):
    import json
    from google.oauth2 import service_account
    from google.analytics.data_v1beta import BetaAnalyticsDataClient

    info = json.loads(service_account_json)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/analytics.readonly"],
    )
    return BetaAnalyticsDataClient(credentials=creds)


def run_report(client, property_id: str, metrics: list, dimensions: list,
               date_range_start: str, date_range_end: str,
               dimension_filter=None):
    from google.analytics.data_v1beta.types import (
        RunReportRequest, DateRange, Metric, Dimension,
    )
    req = RunReportRequest(
        property=property_id,
        date_ranges=[DateRange(start_date=date_range_start, end_date=date_range_end)],
        metrics=[Metric(name=m) for m in metrics],
        dimensions=[Dimension(name=d) for d in dimensions],
        dimension_filter=dimension_filter,
    )
    return client.run_report(req)


def event_count(client, property_id: str, event_name: str,
                start: str, end: str) -> int:
    """Return total count for a single event name in the date range."""
    from google.analytics.data_v1beta.types import (
        RunReportRequest, DateRange, Metric, Dimension,
        FilterExpression, Filter,
    )
    req = RunReportRequest(
        property=property_id,
        date_ranges=[DateRange(start_date=start, end_date=end)],
        metrics=[Metric(name="eventCount")],
        dimensions=[Dimension(name="eventName")],
        dimension_filter=FilterExpression(
            filter=Filter(
                field_name="eventName",
                string_filter=Filter.StringFilter(
                    match_type=Filter.StringFilter.MatchType.EXACT,
                    value=event_name,
                ),
            )
        ),
    )
    resp = client.run_report(req)
    if resp.rows:
        return int(resp.rows[0].metric_values[0].value)
    return 0


def pct(a: int, b: int) -> str:
    if b == 0:
        return "—"
    return f"{round(a / b * 100)}%"


def delta(this_week: int, last_week: int) -> str:
    if last_week == 0:
        return "new"
    d = this_week - last_week
    sign = "+" if d >= 0 else ""
    pct_val = round(d / last_week * 100)
    return f"{sign}{pct_val}%"


def gather_metrics(client, property_id: str) -> dict:
    """Pull all metrics for this week and last week."""

    this_start, this_end = "7daysAgo", "today"
    last_start, last_end = "14daysAgo", "8daysAgo"

    def sessions(start, end):
        resp = run_report(client, property_id,
                          ["sessions", "totalUsers"],
                          ["sessionDefaultChannelGroup"],
                          start, end)
        total_sessions = 0
        total_users = 0
        sources = []
        for row in resp.rows:
            s = int(row.metric_values[0].value)
            u = int(row.metric_values[1].value)
            total_sessions += s
            total_users += u
            sources.append((row.dimension_values[0].value, s))
        sources.sort(key=lambda x: x[1], reverse=True)
        return total_sessions, total_users, sources[:5]

    def device_split(start, end):
        resp = run_report(client, property_id,
                          ["sessions"], ["deviceCategory"], start, end)
        total = 0
        split = {}
        for row in resp.rows:
            cat = row.dimension_values[0].value
            s = int(row.metric_values[0].value)
            total += s
            split[cat] = s
        return {k: pct(v, total) for k, v in split.items()}

    def page_metrics(start, end):
        resp = run_report(client, property_id,
                          ["sessions", "averageSessionDuration", "bounceRate"],
                          ["pagePath"], start, end)
        pages = {}
        for row in resp.rows:
            path = row.dimension_values[0].value
            if path in ("/", "/index.html", "/book.html", "/book"):
                pages[path] = {
                    "sessions": int(row.metric_values[0].value),
                    "avg_duration": round(float(row.metric_values[1].value)),
                    "bounce_rate": round(float(row.metric_values[2].value) * 100),
                }
        return pages

    tw_sessions, tw_users, tw_sources = sessions(this_start, this_end)
    lw_sessions, lw_users, _ = sessions(last_start, last_end)

    tw_devices = device_split(this_start, this_end)
    tw_pages   = page_metrics(this_start, this_end)

    # Funnel events — this week
    ev = {}
    for name in ["cta_click", "form_start", "form_step_complete",
                 "form_submit", "calendar_click", "form_skip"]:
        ev[name] = event_count(client, property_id, name, this_start, this_end)

    lw_ev = {}
    for name in ["form_start", "form_submit", "calendar_click"]:
        lw_ev[name] = event_count(client, property_id, name, last_start, last_end)

    return {
        "this_week": {
            "sessions": tw_sessions,
            "users": tw_users,
            "sources": tw_sources,
            "devices": tw_devices,
            "pages": tw_pages,
            "events": ev,
        },
        "last_week": {
            "sessions": lw_sessions,
            "users": lw_users,
            "events": lw_ev,
        },
    }


def build_data_summary(m: dict) -> str:
    tw = m["this_week"]
    lw = m["last_week"]
    ev = tw["events"]
    lw_ev = lw["events"]

    booking_page_sessions = tw["pages"].get("/book.html", tw["pages"].get("/book", {})).get("sessions", 0)
    home_sessions = tw["pages"].get("/", tw["pages"].get("/index.html", {})).get("sessions", 0)
    home_bounce = tw["pages"].get("/", tw["pages"].get("/index.html", {})).get("bounce_rate", "—")
    home_duration = tw["pages"].get("/", tw["pages"].get("/index.html", {})).get("avg_duration", "—")

    sources_str = "\n".join(
        f"  - {src}: {count} sessions"
        for src, count in tw["sources"]
    )
    devices_str = ", ".join(
        f"{k}: {v}" for k, v in tw["devices"].items()
    )

    return f"""
TRAFFIC (this week vs last week)
- Sessions: {tw['sessions']} ({delta(tw['sessions'], lw['sessions'])} vs last week)
- Unique users: {tw['users']}
- Sessions last week: {lw['sessions']}
- Top traffic sources:
{sources_str}
- Device split: {devices_str}

HOMEPAGE
- Sessions: {home_sessions}
- Avg time on page: {home_duration}s
- Bounce rate: {home_bounce}%

FUNNEL
- CTA clicks (homepage → booking page): {ev['cta_click']}
- Booking page sessions: {booking_page_sessions}
- Form started: {ev['form_start']} ({pct(ev['form_start'], booking_page_sessions)} of page visitors)
  - Last week: {lw_ev['form_start']}
- Form completed (submitted): {ev['form_submit']} ({pct(ev['form_submit'], ev['form_start'])} of starters)
  - Last week: {lw_ev['form_submit']}
- Calendar link clicked after submission: {ev['calendar_click']} ({pct(ev['calendar_click'], ev['form_submit'])} of submitters)
  - Last week: {lw_ev['calendar_click']}
- Skipped straight to calendar (skipped form): {ev['form_skip']}

OVERALL CONVERSION
- Visitor → form submitted: {pct(ev['form_submit'], tw['sessions'])}
- Visitor → calendar clicked: {pct(ev['calendar_click'], tw['sessions'])}
""".strip()


def generate_report(data_summary: str, api_key: str) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    prompt = f"""You are a conversion rate optimisation expert reviewing weekly analytics for JP Training — a performance coaching business targeting men aged 14–55 at jptraining.fit.

The funnel is: Homepage → CTA click → Booking page → Multi-step form (10 steps) → Success screen → Calendar booking link.

Revenue model: discovery call → paid programme (£1,500–£5,000).

Here is this week's data:

{data_summary}

Write a concise weekly analytics report for the business owner (JP). Structure it exactly like this:

## What's Working
(2–3 bullet points — what the data shows is performing well. Be specific with numbers.)

## Biggest Gap
(The single largest drop-off or problem in the funnel this week. Name it clearly.)

## Top 3 Recommendations
(Ranked by impact. Each one: what to do, why, and what result to expect. Be specific — name the exact page, element, or copy to change.)

## Priority This Week
(One sentence. The single most important action to take before next Monday.)

Keep it direct and specific. No filler. Use the actual numbers."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def send_email(subject: str, body: str, access_key: str):
    import requests

    data = {
        "access_key": access_key,
        "subject": subject,
        "from_name": "JP Training Analytics",
        "message": body,
        "botcheck": "",
    }
    requests.post("https://api.web3forms.com/submit", data=data, timeout=15)


# ── Scheduled function ────────────────────────────────────────────────────────

@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("ga4-secret"),
        modal.Secret.from_name("anthropic-secret"),
    ],
    schedule=modal.Cron("0 9 * * 1"),  # Every Monday 9am UTC (10am BST)
    timeout=120,
)
def weekly_report():
    import os
    from datetime import date

    property_id         = os.environ["GA4_PROPERTY_ID"]       # e.g. "properties/123456789"
    service_account_json = os.environ["GA4_SERVICE_ACCOUNT_JSON"]
    anthropic_key       = os.environ["ANTHROPIC_API_KEY"]
    web3forms_key       = os.environ.get("WEB3FORMS_KEY", "d7afb74a-4ae2-49af-9090-d0f08cfd62ba")

    client = build_ga4_client(service_account_json)
    metrics = gather_metrics(client, property_id)
    data_summary = build_data_summary(metrics)
    analysis = generate_report(data_summary, anthropic_key)

    week_label = date.today().strftime("%-d %B %Y")
    full_report = f"""JP Training — Weekly Analytics Report
Week ending {week_label}

{'='*60}
RAW DATA
{'='*60}

{data_summary}

{'='*60}
ANALYSIS & RECOMMENDATIONS
{'='*60}

{analysis}
"""

    send_email(
        subject=f"JP Training Analytics — w/e {week_label}",
        body=full_report,
        access_key=web3forms_key,
    )
    print(f"Report sent for week ending {week_label}")


# ── Manual trigger (test without waiting for Monday) ─────────────────────────

@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("ga4-secret"),
        modal.Secret.from_name("anthropic-secret"),
    ],
    timeout=120,
)
@modal.fastapi_endpoint(method="POST")
def trigger_report(body: dict = {}):
    """POST to this endpoint to fire the report immediately."""
    from fastapi.responses import JSONResponse

    weekly_report.local()
    return JSONResponse({"status": "ok", "message": "Report sent"})
