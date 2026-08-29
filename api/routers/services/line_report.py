import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from ...database import redis
from ..schemas.schemas import LineReportCreate


REPORT_VALID_SECONDS = 15 * 60
IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60


def _reports_key(station_name: str) -> str:
    return f"line_reports:{station_name}"

def set_line_report(report: LineReportCreate, idempotency_key: str | None = None):
    if idempotency_key:
        cached = redis.get(f"line_report_idempotency:{idempotency_key}")
        if cached:
            return json.loads(cached)

    now = datetime.now(timezone.utc)
    timestamp = now.timestamp()
    stored_report = {
        "id": str(uuid4()),
        "station_name": report.station_name,
        "congestion_level": report.congestion_level,
        "device_id": report.device_id,
        "reported_at": now.isoformat().replace("+00:00", "Z"),
    }

    key = _reports_key(report.station_name)
    redis.zadd(key, {json.dumps(stored_report): timestamp})
    redis.zremrangebyscore(key, "-inf", timestamp - REPORT_VALID_SECONDS)
    redis.expire(key, REPORT_VALID_SECONDS)

    response = {
        "id": stored_report["id"],
        "station_name": report.station_name,
        "congestion_level": report.congestion_level,
        "reported_at": stored_report["reported_at"],
    }
    if idempotency_key:
        redis.set(
            f"line_report_idempotency:{idempotency_key}",
            json.dumps(response),
            ex=IDEMPOTENCY_TTL_SECONDS,
        )
    return response


def get_station_status(station_name: str):
    timestamp = time.time()
    key = _reports_key(station_name)
    redis.zremrangebyscore(key, "-inf", timestamp - REPORT_VALID_SECONDS)
    values = redis.zrangebyscore(key, timestamp - REPORT_VALID_SECONDS, "+inf")
    reports = [json.loads(value) for value in values]

    if not reports:
        return {
            "level": None,
            "confidence": "low",
            "report_count": 0,
            "updated_at": None,
            "message": "아직 최근 제보가 없어요",
            "incoming_bus": None,
        }

    # 한 기기의 반복 제보가 결과를 과도하게 왜곡하지 않도록 최신 값만 사용한다.
    latest_by_device = {}
    for item in reports:
        latest_by_device[item["device_id"]] = item
    valid_reports = list(latest_by_device.values())
    average = sum(item["congestion_level"] for item in valid_reports) / len(valid_reports)
    level = max(1, min(5, int(average + 0.5)))
    count = len(valid_reports)

    return {
        "level": level,
        "confidence": "high" if count >= 5 else "medium" if count >= 2 else "low",
        "report_count": count,
        "updated_at": max(item["reported_at"] for item in valid_reports),
        "message": None,
        "incoming_bus": None,
    }
