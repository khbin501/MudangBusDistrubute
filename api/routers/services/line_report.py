import json
import time
from datetime import datetime, timezone, timedelta
from typing import cast
from uuid import uuid4

from ...database import redis
from ..schemas.schemas import LineReportCreate
from .departure import get_latest_departure, get_latest_queue_reduction


REPORT_VALID_SECONDS = 10 * 60
QUEUE_DECAY_INTERVAL_SECONDS = 2 * 60
IDEMPOTENCY_TTL_SECONDS = 1 * 60
REPORT_COOLDOWN_SECONDS = 30


class ReportCooldownError(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after

#set_line_report 안에서만 쓰이는 내장 함수
def _reports_key(station_name: str) -> str:
    return f"line_reports:{station_name}"


def _cooldown_key(station_name: str, device_id: str) -> str:
    return f"line_report_cooldown:{station_name}:{device_id}"


#post로 받은 값 DB에 반영
def set_line_report(report: LineReportCreate, idempotency_key: str | None = None):

    now = datetime.now(timezone(timedelta(hours=9))) # KST 현재 시각 
    timestamp = now.timestamp()

    if idempotency_key: # idempotency key 캐싱데이터 불러오고 없으면 캐싱 재전송 오류 방지
        cached = redis.get(f"line_report_idempotency:{idempotency_key}")
        
        if cached:
            return json.loads(cached)

    cooldown_key = _cooldown_key(report.station_name, report.device_id)
    cooldown_created = redis.set(
        cooldown_key,
        "1",
        nx=True,
        ex=REPORT_COOLDOWN_SECONDS,
    )
    if not cooldown_created:
        retry_after = redis.ttl(cooldown_key)
        raise ReportCooldownError(max(int(retry_after), 0))

    stored_report = { # post로 들어온 값 DB에 저장할 딕셔너리로 만들기
        "id": str(uuid4()), # 제보 하나를 지칭 하는 id
        "station_name": report.station_name,
        "congestion_level": report.congestion_level,
        "device_id": report.device_id,# 브라우저에서 넘겨받은 유저 고유값
        "reported_at": now.isoformat()
    }

    try:
        key = _reports_key(report.station_name) # 정류장 이름을 키값으로 생성

        #redis에 key:정류장이름 / timestamp : stored_report(json) 각각 DB에 저장됨
        redis.zadd(key, {json.dumps(stored_report): timestamp})

        # 각 정류장에 쌓인 멤버 일정 시간 지나면 자동삭제
        redis.zremrangebyscore(key, "-inf", timestamp - REPORT_VALID_SECONDS)

        #정류장 키 자체도 일정 시간 지나면 자동삭제 마지막 신고가 Redis에 계속 남는거 방지
        redis.expire(key, REPORT_VALID_SECONDS)
    except Exception:
        # 제보 저장에 실패했으면 쿨타임 키도 되돌린다.
        redis.delete(cooldown_key)
        raise

    #api 외부 공개용 response 
    response = {
        "id": stored_report["id"],
        "station_name": report.station_name,
        "congestion_level": report.congestion_level,
        "reported_at": stored_report["reported_at"],
    }
    if idempotency_key: #중복 응답 방지용 
        redis.set(
            f"line_report_idempotency:{idempotency_key}",
            json.dumps(response),
            ex=IDEMPOTENCY_TTL_SECONDS,
        )
    return response



def get_station_status(station_name: str):
    now = datetime.now(timezone(timedelta(hours=9)))
    timestamp = time.time()
    key = _reports_key(station_name)
    redis.zremrangebyscore(key, "-inf", timestamp - REPORT_VALID_SECONDS)

    values = cast(
        list[str],
        redis.zrangebyscore(key, timestamp - REPORT_VALID_SECONDS, "+inf"),
    )
    reports = [json.loads(value) for value in values]
    incoming_bus = get_latest_departure(station_name)
    queue_reduction = get_latest_queue_reduction(station_name)

    if not reports:
        return {
            "level": None,
            "confidence": "low",
            "report_count": 0,
            "updated_at": None,
            "message": "아직 최근 제보가 없어요",
            "incoming_bus": incoming_bus,
        }

    # 한 기기의 반복 제보가 결과를 과도하게 왜곡하지 않도록 최신 값만 사용한다.
    latest_by_device = {}
    for item in reports:
        latest_by_device[item["device_id"]] = item
    valid_reports = list(latest_by_device.values())
    average = sum(item["congestion_level"] for item in valid_reports) / len(valid_reports)
    level = max(1, min(5, int(average + 0.5)))
    latest_reported_at = max(datetime.fromisoformat(item["reported_at"]) for item in valid_reports)
    no_report_seconds = max(0, (now - latest_reported_at).total_seconds())
    decay_levels = int(no_report_seconds // QUEUE_DECAY_INTERVAL_SECONDS)
    level = max(1, level - decay_levels)
    if queue_reduction:
        level = max(1, level - queue_reduction)
    count = len(valid_reports)

    return {
        "level": level,
        "confidence": "high" if count >= 5 else "medium" if count >= 2 else "low",
        "report_count": count,
        "updated_at": latest_reported_at.isoformat(),
        "message": None,
        "incoming_bus": incoming_bus,
    }
