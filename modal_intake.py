"""
JP Training — Lead Intake
Receives quiz submissions from jptraining.fit/book.html
Adds subscriber to MailerLite with segment group + custom fields.

Deploy: /Users/jp/Library/Python/3.9/bin/modal deploy "/Users/jp/VS Code Workspace/jp-training/modal_intake.py"
"""

import modal
import os
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jp-training")

app = modal.App("jp-training")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi", "requests")
)


def get_or_create_group(name: str, headers: dict) -> str:
    """Return MailerLite group ID for the given name, creating it if needed."""
    import requests
    resp = requests.get("https://connect.mailerlite.com/api/groups?limit=100", headers=headers, timeout=10)
    for group in resp.json().get("data", []):
        if group["name"] == name:
            return group["id"]
    resp = requests.post(
        "https://connect.mailerlite.com/api/groups",
        headers=headers,
        json={"name": name},
        timeout=10,
    )
    return resp.json()["data"]["id"]


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("mailerlite-secret")],
    timeout=30,
)
@modal.fastapi_endpoint(method="POST")
def jp_training_lead(body: dict):
    """
    Intake endpoint for JP Training quiz submissions.
    Called from book.html immediately after Web3Forms fires.
    """
    import requests
    from fastapi.responses import JSONResponse

    ml_key = os.getenv("MAILERLITE_API_KEY")
    if not ml_key:
        return JSONResponse({"status": "error", "detail": "MAILERLITE_API_KEY not set"}, status_code=200)

    headers = {
        "Authorization": f"Bearer {ml_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    name      = body.get("name", "").strip()
    email     = body.get("email", "").strip()
    phone     = body.get("phone", "").strip()
    age_raw   = body.get("age", "")
    goals     = body.get("goals", [])
    timeline  = body.get("timeline", "")

    # Determine segment from age
    try:
        age = int(age_raw)
    except (ValueError, TypeError):
        age = 0

    if 0 < age < 18:
        segment = "Youth Athlete"
    elif age <= 25:
        segment = "Young Man"
    elif age <= 35:
        segment = "Slipping Man"
    else:
        segment = "Performance Man"

    goals_str = ", ".join(goals) if isinstance(goals, list) else str(goals)

    name_parts = name.split(" ", 1)
    first_name = name_parts[0]
    last_name  = name_parts[1] if len(name_parts) > 1 else ""

    logger.info(f"Lead: {name} | {phone} | {email} | age={age_raw} → {segment} | timeline={timeline}")

    # Can't add to MailerLite without an email
    if not email:
        return JSONResponse({"status": "ok", "note": "no_email"})

    group_id = get_or_create_group(segment, headers)

    payload = {
        "email": email,
        "fields": {
            "name":              first_name,
            "last_name":         last_name,
            "phone":             phone,
            "age":               str(age_raw),
            "goals":             goals_str,
            "training_history":  body.get("training_history", ""),
            "frustration":       body.get("frustration", ""),
            "lifestyle":         body.get("lifestyle", ""),
            "sleep_quality":     body.get("sleep", ""),
            "energy_level":      body.get("energy", ""),
            "health_conditions": body.get("health", ""),
            "previous_coaching": body.get("previous_coaching", ""),
            "timeline":          timeline,
            "source":            "website_quiz",
        },
        "groups": [group_id],
    }

    resp = requests.post(
        "https://connect.mailerlite.com/api/subscribers",
        headers=headers,
        json=payload,
        timeout=15,
    )

    if resp.status_code not in (200, 201):
        logger.error(f"MailerLite error {resp.status_code}: {resp.text}")
        return JSONResponse({"status": "error", "detail": resp.text}, status_code=200)

    logger.info(f"Added to MailerLite: {email} → {segment} (group {group_id})")
    return JSONResponse({"status": "ok", "segment": segment, "group_id": group_id})
