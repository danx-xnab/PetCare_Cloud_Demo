"""Huawei Cloud FunctionGraph entry for PetCare Cloud daily summary.

Configure these environment variables in FunctionGraph:

- PETCARE_BACKEND_URL: http://your-ecs-public-ip:8000
- PETCARE_FUNCTION_TOKEN: same token as the ECS .env file
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any


def _event_payload(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        return {}

    payload: dict[str, Any] = {}
    body = event.get("body")
    if body:
        try:
            if event.get("isBase64Encoded"):
                body = base64.b64decode(body).decode("utf-8")
            payload.update(json.loads(body))
        except (ValueError, TypeError):
            payload["raw_body"] = str(body)[:500]

    for key in ("date", "trigger_type", "triggerType"):
        if event.get(key):
            payload[key] = event[key]
    return payload


def handler(event, context):
    backend_url = os.environ.get("PETCARE_BACKEND_URL", "").rstrip("/")
    token = os.environ.get("PETCARE_FUNCTION_TOKEN", "")
    if not backend_url:
        raise RuntimeError("PETCARE_BACKEND_URL is required")

    event_payload = _event_payload(event)
    body = {
        "function_name": "daily-care-summary",
        "trigger_type": event_payload.get("trigger_type") or event_payload.get("triggerType") or "functiongraph",
        "date": event_payload.get("date") or datetime.now().date().isoformat(),
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{backend_url}/api/cloud/function/daily-summary",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "X-Function-Token": token,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            text = response.read().decode("utf-8")
            return json.loads(text)
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"PetCare backend returned HTTP {exc.code}: {error_body}") from exc
