#!/usr/bin/env python3
"""PetCare Cloud demo server.

The app intentionally uses only the Python standard library so it can run on a
fresh ECS host, inside Docker, or on a classroom laptop without dependency
installation. If an OpenAI-compatible API key is configured, the parser tries to
use it first; otherwise a deterministic rule parser keeps the demo usable.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sqlite3
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
UPLOAD_DIR = ROOT / "uploads"
DB_PATH = Path(os.getenv("PETCARE_DB", DATA_DIR / "petcare.db"))

DEFAULT_USER_ID = "user-demo"

# Runtime LLM configuration (overrides env vars; set via /api/llm/config)
_runtime_llm_config: dict[str, str] = {}


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def json_dumps(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")


def get_llm_config() -> tuple[str, str, str]:
    """Return (api_key, base_url, model) from runtime config or env vars."""
    key = _runtime_llm_config.get("api_key") or os.getenv("OPENAI_API_KEY", "")
    url = (
        _runtime_llm_config.get("base_url")
        or os.getenv("PETCARE_LLM_URL")
        or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    )
    model = (
        _runtime_llm_config.get("model")
        or os.getenv("PETCARE_LLM_MODEL")
        or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    )
    return key, url, model


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pets (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              name TEXT NOT NULL,
              species TEXT NOT NULL,
              breed TEXT,
              birthday TEXT,
              weight REAL,
              avatar_url TEXT,
              notes TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              pet_id TEXT,
              raw_content TEXT NOT NULL,
              input_type TEXT NOT NULL,
              parsed_result TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS health_logs (
              id TEXT PRIMARY KEY,
              pet_id TEXT NOT NULL,
              date TEXT NOT NULL,
              record_type TEXT NOT NULL,
              symptoms TEXT,
              summary TEXT NOT NULL,
              severity TEXT,
              source_message_id TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reminders (
              id TEXT PRIMARY KEY,
              pet_id TEXT NOT NULL,
              title TEXT NOT NULL,
              reminder_time TEXT NOT NULL,
              repeat_rule TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              source_message_id TEXT,
              created_at TEXT NOT NULL
            );
            """
        )
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count == 0:
            seed_demo_data(conn)
        conn.commit()


def seed_demo_data(conn: sqlite3.Connection) -> None:
    ts = now_iso()
    conn.execute(
        "INSERT INTO users (id, username, password, created_at) VALUES (?, ?, ?, ?)",
        (DEFAULT_USER_ID, "demo", "123456", ts),
    )
    pets = [
        (
            "pet-xiaoju",
            DEFAULT_USER_ID,
            "小橘",
            "猫",
            "中华田园猫",
            "2023-04-12",
            4.2,
            "",
            "胆子小，换粮需要循序渐进。",
            ts,
        ),
        (
            "pet-doudou",
            DEFAULT_USER_ID,
            "豆豆",
            "狗",
            "比熊",
            "2021-09-08",
            6.8,
            "",
            "近期在吃皮肤药，需要按时复查。",
            ts,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO pets
        (id, user_id, name, species, breed, birthday, weight, avatar_url, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        pets,
    )
    conn.execute(
        """
        INSERT INTO reminders
        (id, pet_id, title, reminder_time, repeat_rule, status, source_message_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "reminder-seed-vaccine",
            "pet-xiaoju",
            "小橘三联疫苗复查",
            (datetime.now() + timedelta(days=2)).replace(hour=9, minute=30, second=0, microsecond=0).isoformat(),
            "once",
            "pending",
            "",
            ts,
        ),
    )
    seed_logs = [
        ("log-s1", "pet-doudou", datetime.now().date().isoformat(),
         "diet",    "[]",
         "豆豆早餐吃了少量犬粮，饮水正常。", "low",  "", ts),
        ("log-s2", "pet-xiaoju", datetime.now().date().isoformat(),
         "health",  '["食欲下降","呕吐"]',
         "小橘出现食欲下降、呕吐，建议继续观察饮食、精神和排便变化。", "medium", "", ts),
        ("log-s3", "pet-doudou", (datetime.now() - timedelta(days=1)).date().isoformat(),
         "medicine","[]",
         "豆豆昨天按时服用了皮肤消炎药，状态稳定。", "low",  "", ts),
        ("log-s4", "pet-xiaoju", (datetime.now() - timedelta(days=2)).date().isoformat(),
         "vaccine", "[]",
         "小橘完成三联疫苗第一针接种，一年后需补打。", "low",  "", ts),
        ("log-s5", "pet-doudou", (datetime.now() - timedelta(days=3)).date().isoformat(),
         "deworm",  "[]",
         "豆豆完成体内驱虫，下个月安排体外驱虫。", "low",  "", ts),
    ]
    conn.executemany(
        """INSERT INTO health_logs
           (id, pet_id, date, record_type, symptoms, summary, severity, source_message_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        seed_logs,
    )
    seed_reminders_extra = [
        ("rem-seed-med", "pet-doudou",
         "给豆豆喂皮肤消炎药",
         (datetime.now() + timedelta(days=1)).replace(hour=20, minute=0, second=0, microsecond=0).isoformat(),
         "daily", "pending", "", ts),
        ("rem-seed-deworm", "pet-doudou",
         "豆豆体外驱虫",
         (datetime.now() + timedelta(days=30)).replace(hour=9, minute=0, second=0, microsecond=0).isoformat(),
         "once", "pending", "", ts),
    ]
    conn.executemany(
        """INSERT INTO reminders
           (id, pet_id, title, reminder_time, repeat_rule, status, source_message_id, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        seed_reminders_extra,
    )


def rows(query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connect() as conn:
        return [dict(row) for row in conn.execute(query, params).fetchall()]


def one(query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(query, params).fetchone()
        return dict(row) if row else None


def get_state() -> dict[str, Any]:
    pets = rows("SELECT * FROM pets ORDER BY created_at ASC")
    logs = rows("SELECT * FROM health_logs ORDER BY created_at DESC LIMIT 80")
    reminders = rows("SELECT * FROM reminders ORDER BY status ASC, reminder_time ASC LIMIT 80")
    messages = rows("SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 40")
    for message in messages:
        try:
            message["parsed_result"] = json.loads(message["parsed_result"])
        except json.JSONDecodeError:
            pass
    today = datetime.now().date().isoformat()
    pending_today = [
        item
        for item in reminders
        if item["status"] == "pending" and item["reminder_time"][:10] <= today
    ]
    abnormal_logs = [item for item in logs if item.get("severity") in {"medium", "high"}]

    api_key, _, model = get_llm_config()
    llm_desc = f"LLM 已接入 ({model})" if api_key else "规则解析（未配置 LLM）"

    return {
        "user": {"id": DEFAULT_USER_ID, "username": "demo"},
        "pets": pets,
        "logs": logs,
        "reminders": reminders,
        "messages": messages,
        "stats": {
            "pet_count": len(pets),
            "pending_today": len(pending_today),
            "log_count": len(logs),
            "abnormal_count": len(abnormal_logs),
        },
        "cloud": {
            "ecs": "ECS 云服务器（在线）",
            "database": "SQLite / RDS 云数据库",
            "object_storage": "本地存储 / OBS 对象存储",
            "llm": llm_desc,
            "worker": "同步处理 / RocketMQ 异步就绪",
        },
        "llm_available": bool(api_key),
    }


def call_llm(system: str, user: str, temperature: float = 0.1) -> str | None:
    """Call the configured LLM API. Returns response text or None on failure."""
    api_key, base_url, model = get_llm_config()
    if not api_key:
        return None
    url = base_url.rstrip("/")
    if not url.endswith("/chat/completions"):
        url = url + "/chat/completions"
    payload = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
        return body["choices"][0]["message"]["content"].strip()
    except (OSError, urllib.error.URLError, KeyError, json.JSONDecodeError):
        return None


def try_llm_parse(content: str, pets: list[dict[str, Any]]) -> dict[str, Any] | None:
    pet_names = [pet["name"] for pet in pets]
    system = (
        "你是 PetCare Cloud 的宠物记录解析器。"
        "只输出 JSON，不输出 Markdown 代码块。字段必须包含："
        "pet_name（字符串）, record_type（health/medicine/diet/vaccine/deworm/diary之一）, "
        "event_time（字符串）, summary（字符串）, symptoms（字符串数组）, severity（low/medium/high之一）, "
        "need_reminder（布尔）, reminder（含 title 和 time 的对象）, reply（字符串，友好回复）。"
    )
    user = f"已有宠物：{pet_names}\n用户输入：{content}"
    text = call_llm(system, user)
    if not text:
        return None
    try:
        # Strip markdown code fences if present
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.M)
        text = re.sub(r"```\s*$", "", text, flags=re.M)
        match = re.search(r"\{.*\}", text.strip(), flags=re.S)
        if not match:
            return None
        parsed = json.loads(match.group(0))
        parsed["_parser"] = "llm"
        return normalize_parse(parsed, content, pets)
    except (json.JSONDecodeError, KeyError):
        return None


def normalize_parse(parsed: dict[str, Any], content: str, pets: list[dict[str, Any]]) -> dict[str, Any]:
    pet = find_pet(content, pets, preferred=parsed.get("pet_name"))
    parsed["pet_name"] = pet["name"] if pet else parsed.get("pet_name") or "未指定宠物"
    parsed["pet_id"] = pet["id"] if pet else ""
    parsed["record_type"] = parsed.get("record_type") or "diary"
    parsed["event_time"] = parsed.get("event_time") or "刚刚"
    parsed["summary"] = parsed.get("summary") or content
    parsed["symptoms"] = parsed.get("symptoms") if isinstance(parsed.get("symptoms"), list) else []
    parsed["severity"] = parsed.get("severity") or "low"
    parsed["need_reminder"] = bool(parsed.get("need_reminder"))
    reminder = parsed.get("reminder") if isinstance(parsed.get("reminder"), dict) else {}
    parsed["reminder"] = {
        "title": reminder.get("title", ""),
        "time": reminder.get("time", ""),
        "reminder_time": resolve_reminder_time(str(reminder.get("time", "")), content).isoformat()
        if parsed["need_reminder"]
        else "",
    }
    parsed["reply"] = parsed.get("reply") or build_reply(parsed)
    return parsed


def find_pet(content: str, pets: list[dict[str, Any]], preferred: str | None = None) -> dict[str, Any] | None:
    if preferred:
        for pet in pets:
            if pet["name"] == preferred:
                return pet
    for pet in pets:
        if pet["name"] and pet["name"] in content:
            return pet
    return pets[0] if pets else None


def parse_pet_record(content: str, pets: list[dict[str, Any]]) -> dict[str, Any]:
    llm_result = try_llm_parse(content, pets)
    if llm_result:
        return llm_result

    pet = find_pet(content, pets)
    pet_name = pet["name"] if pet else "未指定宠物"
    record_type = classify_record(content)
    symptoms = detect_symptoms(content)
    severity = estimate_severity(content, symptoms)
    event_phrase = detect_event_time(content)
    reminder_needed = should_create_reminder(content, record_type, symptoms)
    reminder_time = resolve_reminder_time(content, content) if reminder_needed else None
    summary = build_summary(pet_name, content, record_type, symptoms)
    reminder_title = build_reminder_title(pet_name, record_type, symptoms, content)

    parsed = {
        "_parser": "rule-fallback",
        "pet_name": pet_name,
        "pet_id": pet["id"] if pet else "",
        "record_type": record_type,
        "event_time": event_phrase,
        "summary": summary,
        "symptoms": symptoms,
        "severity": severity,
        "need_reminder": reminder_needed,
        "reminder": {
            "title": reminder_title if reminder_needed else "",
            "time": detect_reminder_phrase(content) if reminder_needed else "",
            "reminder_time": reminder_time.isoformat() if reminder_time else "",
        },
    }
    parsed["reply"] = build_reply(parsed)
    return parsed


def classify_record(content: str) -> str:
    rules = [
        ("vaccine", ["疫苗", "接种", "针"]),
        ("deworm", ["驱虫"]),
        ("medicine", ["吃药", "喂药", "药", "复诊", "用药"]),
        ("health", ["吐", "呕吐", "拉稀", "腹泻", "咳", "喷嚏", "没精神", "没怎么吃", "不吃", "发烧", "流血"]),
        ("diet", ["吃饭", "喂", "粮", "罐头", "喝水", "食欲"]),
    ]
    for record_type, keywords in rules:
        if any(keyword in content for keyword in keywords):
            return record_type
    return "diary"


def detect_symptoms(content: str) -> list[str]:
    symptom_map = {
        "呕吐": ["吐", "呕吐"],
        "食欲下降": ["没怎么吃", "不吃", "食欲差", "没吃饭"],
        "腹泻": ["拉稀", "腹泻"],
        "咳嗽": ["咳"],
        "打喷嚏": ["喷嚏"],
        "精神不佳": ["没精神", "蔫"],
        "出血": ["流血", "血"],
        "发热": ["发烧", "发热"],
    }
    detected = []
    for label, keywords in symptom_map.items():
        if any(keyword in content for keyword in keywords):
            detected.append(label)
    return detected


def estimate_severity(content: str, symptoms: list[str]) -> str:
    high_markers = ["多次", "一直", "流血", "抽搐", "站不起来", "呼吸困难"]
    if any(marker in content for marker in high_markers):
        return "high"
    if symptoms:
        return "medium" if any(item in symptoms for item in ["呕吐", "腹泻", "食欲下降"]) else "low"
    return "low"


def detect_event_time(content: str) -> str:
    phrases = ["今天晚上", "今晚", "今天早上", "今天中午", "明天晚上", "明晚", "明天早上", "昨天", "刚刚"]
    for phrase in phrases:
        if phrase in content:
            return phrase
    hour = re.search(r"([0-2]?\d)\s*[点:：时]", content)
    if hour:
        return f"{hour.group(1)}点左右"
    return "刚刚"


def detect_reminder_phrase(content: str) -> str:
    phrases = ["明天早上", "明早", "明天晚上", "明晚", "今晚", "明天", "后天"]
    for phrase in phrases:
        if phrase in content:
            return phrase
    return "明天早上"


def should_create_reminder(content: str, record_type: str, symptoms: list[str]) -> bool:
    trigger_words = ["提醒", "还要", "再吃一次", "复查", "再打", "再来一次", "下次", "一年后", "下个月", "下周", "明天还", "再用一次"]
    if any(w in content for w in trigger_words):
        return True
    # Vaccines and deworm always create a follow-up reminder
    if record_type in {"vaccine", "deworm"}:
        return True
    return record_type in {"health", "medicine"} and bool(symptoms or "药" in content)


def resolve_reminder_time(phrase: str, content: str) -> datetime:
    base = datetime.now().replace(second=0, microsecond=0)
    text = phrase + content
    if "一年后" in text or "明年" in text:
        base += timedelta(days=365)
    elif "半年后" in text:
        base += timedelta(days=180)
    elif "下个月" in text or "一个月后" in text:
        base += timedelta(days=30)
    elif "下周" in text or "一周后" in text:
        base += timedelta(days=7)
    elif "后天" in text:
        base += timedelta(days=2)
    elif "明" in text:
        base += timedelta(days=1)
    elif "今晚" in text:
        pass
    else:
        base += timedelta(days=1)

    if "早" in text:
        return base.replace(hour=8, minute=30)
    if "中午" in text:
        return base.replace(hour=12, minute=0)
    hour_match = re.search(r"([0-2]?\d)\s*[点:：时]", text)
    if hour_match:
        hour = max(0, min(23, int(hour_match.group(1))))
        return base.replace(hour=hour, minute=0)
    if "晚" in text:
        return base.replace(hour=20, minute=0)
    return base.replace(hour=9, minute=0)


def build_summary(pet_name: str, content: str, record_type: str, symptoms: list[str]) -> str:
    if record_type == "health" and symptoms:
        return f"{pet_name}出现{', '.join(symptoms)}，建议继续观察并记录饮食、精神和排便变化。"
    if record_type == "medicine":
        return f"{pet_name}的用药记录：{content}"
    if record_type == "diet":
        return f"{pet_name}的饮食记录：{content}"
    if record_type == "vaccine":
        return f"{pet_name}的疫苗记录：{content}"
    if record_type == "deworm":
        return f"{pet_name}的驱虫记录：{content}"
    return f"{pet_name}的日常记录：{content}"


def build_reminder_title(pet_name: str, record_type: str, symptoms: list[str], content: str) -> str:
    if record_type == "medicine":
        return f"按计划给{pet_name}用药"
    if record_type == "vaccine":
        return f"确认{pet_name}疫苗安排"
    if record_type == "deworm":
        return f"确认{pet_name}驱虫安排"
    if symptoms:
        return f"观察{pet_name}{'、'.join(symptoms)}情况"
    if "复查" in content:
        return f"带{pet_name}复查"
    return f"查看{pet_name}状态"


def build_reply(parsed: dict[str, Any]) -> str:
    pet_name = parsed.get("pet_name", "宠物")
    type_label = {
        "health": "健康日志",
        "medicine": "用药记录",
        "diet": "饮食记录",
        "vaccine": "疫苗记录",
        "deworm": "驱虫记录",
        "diary": "日常记录",
    }.get(parsed.get("record_type"), "记录")
    if parsed.get("need_reminder"):
        title = parsed.get("reminder", {}).get("title", "后续提醒")
        return f"已保存为{pet_name}的{type_label}，并生成提醒：{title}。"
    return f"已保存为{pet_name}的{type_label}。"


def create_chat_record(content: str, input_type: str = "text") -> dict[str, Any]:
    pets = rows("SELECT * FROM pets ORDER BY created_at ASC")
    parsed = parse_pet_record(content, pets)
    message_id = f"msg-{uuid.uuid4().hex[:10]}"
    created_at = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO chat_messages
            (id, user_id, pet_id, raw_content, input_type, parsed_result, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                DEFAULT_USER_ID,
                parsed.get("pet_id"),
                content,
                input_type,
                json.dumps(parsed, ensure_ascii=False),
                created_at,
            ),
        )
        if parsed.get("pet_id"):
            conn.execute(
                """
                INSERT INTO health_logs
                (id, pet_id, date, record_type, symptoms, summary, severity, source_message_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"log-{uuid.uuid4().hex[:10]}",
                    parsed["pet_id"],
                    datetime.now().date().isoformat(),
                    parsed["record_type"],
                    json.dumps(parsed.get("symptoms", []), ensure_ascii=False),
                    parsed["summary"],
                    parsed["severity"],
                    message_id,
                    created_at,
                ),
            )
        if parsed.get("need_reminder") and parsed.get("pet_id"):
            reminder = parsed.get("reminder", {})
            conn.execute(
                """
                INSERT INTO reminders
                (id, pet_id, title, reminder_time, repeat_rule, status, source_message_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"rem-{uuid.uuid4().hex[:10]}",
                    parsed["pet_id"],
                    reminder.get("title") or "查看宠物状态",
                    reminder.get("reminder_time") or resolve_reminder_time("", content).isoformat(),
                    "once",
                    "pending",
                    message_id,
                    created_at,
                ),
            )
        conn.commit()
    return {"message_id": message_id, "parsed": parsed, "state": get_state()}


def create_pet(payload: dict[str, Any]) -> dict[str, Any]:
    pet_id = f"pet-{uuid.uuid4().hex[:10]}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO pets
            (id, user_id, name, species, breed, birthday, weight, avatar_url, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pet_id,
                DEFAULT_USER_ID,
                payload.get("name", "").strip(),
                payload.get("species", "").strip() or "未知",
                payload.get("breed", "").strip(),
                payload.get("birthday", "").strip(),
                float(payload["weight"]) if str(payload.get("weight", "")).strip() else None,
                payload.get("avatar_url", "").strip(),
                payload.get("notes", "").strip(),
                now_iso(),
            ),
        )
        conn.commit()
    return {"pet": one("SELECT * FROM pets WHERE id = ?", (pet_id,)), "state": get_state()}


def update_pet(pet_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    pet = one("SELECT * FROM pets WHERE id = ?", (pet_id,))
    if not pet:
        raise ValueError("宠物不存在")
    with connect() as conn:
        conn.execute(
            """
            UPDATE pets SET name=?, species=?, breed=?, birthday=?, weight=?, notes=?
            WHERE id=?
            """,
            (
                payload.get("name", pet["name"]).strip(),
                payload.get("species", pet["species"]).strip(),
                payload.get("breed", pet.get("breed", "")).strip(),
                payload.get("birthday", pet.get("birthday", "")).strip(),
                float(payload["weight"]) if str(payload.get("weight", "")).strip() else pet.get("weight"),
                payload.get("notes", pet.get("notes", "")).strip(),
                pet_id,
            ),
        )
        conn.commit()
    return {"pet": one("SELECT * FROM pets WHERE id = ?", (pet_id,)), "state": get_state()}


def delete_pet(pet_id: str) -> dict[str, Any]:
    pet = one("SELECT * FROM pets WHERE id = ?", (pet_id,))
    if not pet:
        raise ValueError("宠物不存在")
    with connect() as conn:
        conn.execute("DELETE FROM health_logs WHERE pet_id = ?", (pet_id,))
        conn.execute("DELETE FROM reminders WHERE pet_id = ?", (pet_id,))
        conn.execute("DELETE FROM chat_messages WHERE pet_id = ?", (pet_id,))
        conn.execute("DELETE FROM pets WHERE id = ?", (pet_id,))
        conn.commit()
    return {"state": get_state()}


def create_reminder(payload: dict[str, Any]) -> dict[str, Any]:
    pet_id = payload.get("pet_id", "")
    pet = one("SELECT * FROM pets WHERE id = ?", (pet_id,))
    if not pet:
        raise ValueError("宠物不存在，请先选择宠物")
    title = payload.get("title", "").strip()
    if not title:
        raise ValueError("提醒标题不能为空")
    reminder_time_str = payload.get("reminder_time", "").strip()
    if not reminder_time_str:
        # Default to tomorrow 9am
        reminder_time_str = (datetime.now() + timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0
        ).isoformat()
    rem_id = f"rem-{uuid.uuid4().hex[:10]}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO reminders
            (id, pet_id, title, reminder_time, repeat_rule, status, source_message_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (rem_id, pet_id, title, reminder_time_str, "once", "pending", "", now_iso()),
        )
        conn.commit()
    return {"reminder": one("SELECT * FROM reminders WHERE id = ?", (rem_id,)), "state": get_state()}


def delete_reminder(reminder_id: str) -> dict[str, Any]:
    reminder = one("SELECT * FROM reminders WHERE id = ?", (reminder_id,))
    if not reminder:
        raise ValueError("提醒不存在")
    with connect() as conn:
        conn.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
        conn.commit()
    return {"state": get_state()}


def try_llm_recommend(payload: dict[str, Any]) -> dict[str, Any] | None:
    housing = payload.get("housing", "")
    time_budget = payload.get("time", "")
    money = payload.get("budget", "")
    allergies = payload.get("allergies", "")
    experience = payload.get("experience", "")
    preference = payload.get("preference", "")

    system = (
        "你是专业的宠物顾问。根据用户条件，推荐最多3种适合的宠物，输出 JSON，不输出 Markdown。"
        "格式：{\"recommendations\": [{\"name\": 宠物类型, \"score\": 0-100整数, "
        "\"reason\": 理由, \"care_plan\": 护理建议}], "
        "\"input_summary\": 简短用户画像摘要}"
    )
    user = (
        f"居住空间：{housing}；陪伴时间：{time_budget}；预算：{money}；"
        f"过敏：{allergies}；经验：{experience}；偏好：{preference}"
    )
    text = call_llm(system, user, temperature=0.3)
    if not text:
        return None
    try:
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.M)
        text = re.sub(r"```\s*$", "", text, flags=re.M)
        match = re.search(r"\{.*\}", text.strip(), flags=re.S)
        if not match:
            return None
        result = json.loads(match.group(0))
        result["llm_note"] = "由 LLM 生成个性化推荐"
        return result
    except (json.JSONDecodeError, KeyError):
        return None


def recommend_pet(payload: dict[str, Any]) -> dict[str, Any]:
    llm_result = try_llm_recommend(payload)
    if llm_result:
        return llm_result

    housing = payload.get("housing", "")
    time_budget = payload.get("time", "")
    money = payload.get("budget", "")
    allergies = payload.get("allergies", "")
    experience = payload.get("experience", "")
    preference = payload.get("preference", "")

    recommendations = []
    if "小户型" in housing or "少" in time_budget or "过敏" in allergies:
        recommendations.append(
            {
                "name": "短毛猫 / 成年猫",
                "score": 91,
                "reason": "空间要求相对低，陪伴节奏更灵活；选择成年猫能更准确判断性格和照护难度。",
                "care_plan": "准备猫砂盆、抓板和定时喂食器，前两周重点观察食欲和排便。",
            }
        )
    if "每天" in time_budget or "户外" in preference:
        recommendations.append(
            {
                "name": "中小型犬",
                "score": 86,
                "reason": "如果能稳定遛狗并承担训练时间，中小型犬能提供更强互动和陪伴感。",
                "care_plan": "建立固定遛狗、驱虫和疫苗提醒，初期做基础服从训练。",
            }
        )
    if "低" in money or "新手" in experience:
        recommendations.append(
            {
                "name": "仓鼠 / 小型啮齿类",
                "score": 78,
                "reason": "预算和空间压力较小，但也需要稳定清洁、温度控制和独立笼具。",
                "care_plan": "准备合适笼具、垫料和跑轮，避免频繁打扰造成应激。",
            }
        )
    if not recommendations:
        recommendations.append(
            {
                "name": "成年猫",
                "score": 84,
                "reason": "综合空间、预算和陪伴时间，成年猫的照护节奏更容易预测。",
                "care_plan": "先建立饮食、疫苗、驱虫和体重记录，再逐步扩展照片与健康日志。",
            }
        )
    return {
        "input_summary": f"{housing}；{time_budget}；预算：{money}；偏好：{preference}",
        "recommendations": recommendations[:3],
        "llm_note": "当前为规则版推荐，配置 LLM 后可生成更个性化解释。",
    }


def summarize_pet_health(pet_id: str) -> dict[str, Any]:
    pet = one("SELECT * FROM pets WHERE id = ?", (pet_id,))
    if not pet:
        raise ValueError("宠物不存在")
    logs = rows(
        "SELECT * FROM health_logs WHERE pet_id = ? ORDER BY created_at DESC LIMIT 20",
        (pet_id,),
    )
    if not logs:
        return {"pet_name": pet["name"], "summary": f"{pet['name']}暂无健康记录。", "suggestions": []}

    # Try LLM summary
    logs_text = "\n".join(f"[{l['date']}][{l['record_type']}] {l['summary']}" for l in logs)
    system = (
        "你是宠物健康助手。根据以下健康日志，用简洁中文给出近期健康小结、关注要点和护理建议。"
        "输出 JSON：{\"summary\":\"…\",\"highlights\":[\"…\"],\"suggestions\":[\"…\"]}。不做医疗诊断。"
    )
    user = f"宠物：{pet['name']}\n日志：\n{logs_text}"
    text = call_llm(system, user, temperature=0.4)
    if text:
        try:
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.M)
            text = re.sub(r"```\s*$", "", text, flags=re.M)
            m = re.search(r"\{.*\}", text.strip(), flags=re.S)
            if m:
                result = json.loads(m.group(0))
                result["pet_name"] = pet["name"]
                result["_source"] = "llm"
                return result
        except (json.JSONDecodeError, KeyError):
            pass

    # Rule-based fallback
    abnormal = [l for l in logs if l.get("severity") in ("medium", "high")]
    summary = f"{pet['name']}近期共有 {len(logs)} 条记录。"
    if abnormal:
        summary += f"其中 {len(abnormal)} 条异常记录，建议关注。"
    else:
        summary += "整体状态平稳，未见明显异常。"
    return {
        "pet_name": pet["name"],
        "summary": summary,
        "highlights": [l["summary"] for l in logs[:3]],
        "suggestions": ["保持规律喂食和饮水", "定期驱虫和疫苗", "如有持续异常及时就医"],
        "_source": "rule",
    }


def save_upload(payload: dict[str, Any]) -> dict[str, Any]:
    data_url = payload.get("data_url", "")
    match = re.match(r"data:(?P<mime>[-\w./+]+);base64,(?P<data>.+)", data_url)
    if not match:
        raise ValueError("Invalid data_url")
    mime = payload.get("mime") or match.group("mime")
    extension = mimetypes.guess_extension(mime) or Path(payload.get("filename", "upload.bin")).suffix or ".bin"
    safe_name = f"{uuid.uuid4().hex}{extension}"
    raw = base64.b64decode(match.group("data"))
    target = UPLOAD_DIR / safe_name
    target.write_bytes(raw)
    url = f"/uploads/{safe_name}"
    pet_id = payload.get("pet_id")
    if pet_id:
        with connect() as conn:
            conn.execute("UPDATE pets SET avatar_url = ? WHERE id = ?", (url, pet_id))
            conn.commit()
    return {"url": url, "state": get_state()}


class PetCareHandler(SimpleHTTPRequestHandler):
    server_version = "PetCareCloudDemo/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        if os.getenv("PETCARE_VERBOSE"):
            super().log_message(format, *args)

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json_dumps(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message: str, status: int = 400) -> None:
        self.send_json({"error": message}, status)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/state":
            self.send_json(get_state())
            return
        if path == "/api/llm/status":
            api_key, _, model = get_llm_config()
            self.send_json({
                "available": bool(api_key),
                "model": model,
                "source": "runtime" if _runtime_llm_config.get("api_key") else "env",
            })
            return
        if path.startswith("/uploads/"):
            self.serve_file(UPLOAD_DIR / path.removeprefix("/uploads/"))
            return
        if path.startswith("/static/"):
            self.serve_file(STATIC_DIR / path.removeprefix("/static/"))
            return
        if path == "/" or path == "/index.html":
            self.serve_file(STATIC_DIR / "index.html")
            return
        self.serve_file(STATIC_DIR / "index.html")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            payload = self.read_json()
            if path == "/api/auth/login":
                username = str(payload.get("username", "")).strip() or "demo"
                self.send_json({"user": {"id": DEFAULT_USER_ID, "username": username}, "state": get_state()})
                return
            if path == "/api/pets":
                if not str(payload.get("name", "")).strip():
                    self.send_error_json("宠物名称不能为空")
                    return
                self.send_json(create_pet(payload), 201)
                return
            if path == "/api/chat":
                content = str(payload.get("content", "")).strip()
                if not content:
                    self.send_error_json("聊天内容不能为空")
                    return
                self.send_json(create_chat_record(content, payload.get("input_type", "text")), 201)
                return
            if path == "/api/upload":
                self.send_json(save_upload(payload), 201)
                return
            if path == "/api/recommend":
                self.send_json(recommend_pet(payload), 201)
                return
            if path == "/api/reminders":
                self.send_json(create_reminder(payload), 201)
                return
            summarize_match = re.match(r"^/api/pets/(?P<id>[^/]+)/summarize$", path)
            if summarize_match:
                self.send_json(summarize_pet_health(summarize_match.group("id")))
                return
            if path == "/api/llm/config":
                global _runtime_llm_config
                _runtime_llm_config = {
                    "api_key": str(payload.get("api_key", "")).strip(),
                    "base_url": str(payload.get("base_url", "")).strip(),
                    "model": str(payload.get("model", "")).strip(),
                }
                api_key, _, model = get_llm_config()
                self.send_json({"ok": True, "available": bool(api_key), "model": model})
                return
            reminder_complete = re.match(r"^/api/reminders/(?P<id>[^/]+)/complete$", path)
            if reminder_complete:
                reminder_id = reminder_complete.group("id")
                with connect() as conn:
                    conn.execute("UPDATE reminders SET status = 'done' WHERE id = ?", (reminder_id,))
                    conn.commit()
                self.send_json({"state": get_state()})
                return
            self.send_error_json("接口不存在", 404)
        except ValueError as exc:
            self.send_error_json(str(exc), 400)
        except Exception as exc:  # pragma: no cover
            self.send_error_json(f"服务器处理失败：{exc}", 500)

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            payload = self.read_json()
            pet_match = re.match(r"^/api/pets/(?P<id>[^/]+)$", path)
            if pet_match:
                self.send_json(update_pet(pet_match.group("id"), payload))
                return
            self.send_error_json("接口不存在", 404)
        except ValueError as exc:
            self.send_error_json(str(exc), 400)
        except Exception as exc:
            self.send_error_json(f"服务器处理失败：{exc}", 500)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            pet_match = re.match(r"^/api/pets/(?P<id>[^/]+)$", path)
            if pet_match:
                self.send_json(delete_pet(pet_match.group("id")))
                return
            rem_match = re.match(r"^/api/reminders/(?P<id>[^/]+)$", path)
            if rem_match:
                self.send_json(delete_reminder(rem_match.group("id")))
                return
            self.send_error_json("接口不存在", 404)
        except ValueError as exc:
            self.send_error_json(str(exc), 400)
        except Exception as exc:
            self.send_error_json(f"服务器处理失败：{exc}", 500)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def serve_file(self, path: Path) -> None:
        resolved = path.resolve()
        allowed_roots = [STATIC_DIR.resolve(), UPLOAD_DIR.resolve()]
        if not any(str(resolved).startswith(str(root)) for root in allowed_roots):
            self.send_error(403)
            return
        if not resolved.exists() or not resolved.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        body = resolved.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run PetCare Cloud demo server")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    args = parser.parse_args()
    init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), PetCareHandler)
    print(f"PetCare Cloud demo running at http://{args.host}:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
