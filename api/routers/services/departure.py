import json
import time
from collections import Counter
from datetime import datetime, timezone, timedelta
from threading import Timer
from typing import cast
from uuid import uuid4

from ...database import redis
from ..schemas.schemas import DepartureCreate


DEPARTURE_VALID_SECONDS = 4 * 60
DEPARTURE_COOLDOWN_SECONDS = 3 * 60
DEPARTURE_VOTE_WINDOW_SECONDS = 30
IDEMPOTENCY_TTL_SECONDS = 1 * 60

STATION_NAMES = {
    "semiconductor": "반도체대학 앞",
    "ai_engineering": "AI공학관 앞",
}

OPPOSITE_STATIONS = {
    "semiconductor": "ai_engineering",
    "ai_engineering": "semiconductor",
}

BUS_QUEUE_REDUCTIONS = {
    "small": 1,
    "large": 1.5,
    "white": 3,
}


class DepartureCooldownError(Exception):
    def __init__(self, retry_after: int, message: str):
        self.retry_after = retry_after
        self.message = message


def _departures_key(station: str) -> str:
    return f"departures:{station}"


def _queue_reductions_key(station: str) -> str:
    return f"departure_queue_reductions:{station}"


def _cooldown_key(station: str, device_id: str) -> str:
    return f"departure_cooldown:{station}:{device_id}"


def _pending_votes_key(station: str) -> str:
    return f"departure_votes:{station}"


def _vote_window_key(station: str) -> str:
    return f"departure_vote_window:{station}"


def _finalized_vote_key(station: str, batch_id: str) -> str:
    return f"departure_vote_finalized:{station}:{batch_id}"


def _store_confirmed_departure(departure: dict, timestamp: float) -> None:
    destination_station = OPPOSITE_STATIONS[departure["station"]]
    arrival_key = _departures_key(destination_station)
    queue_reduction_key = _queue_reductions_key(departure["station"])
    serialized_departure = json.dumps(departure)
    redis.zadd(arrival_key, {serialized_departure: timestamp})
    redis.zadd(queue_reduction_key, {serialized_departure: timestamp})
    redis.zremrangebyscore(arrival_key, "-inf", timestamp - DEPARTURE_VALID_SECONDS)
    redis.zremrangebyscore(queue_reduction_key, "-inf", timestamp - DEPARTURE_VALID_SECONDS)
    redis.expire(arrival_key, DEPARTURE_VALID_SECONDS)
    redis.expire(queue_reduction_key, DEPARTURE_VALID_SECONDS)


def _finalize_vote_batch(station: str, batch_id: str) -> None:
    # 아직 투표 창이 열려 있으면 확정하지 않는다.
    if redis.get(_vote_window_key(station)) == batch_id:
        return

    pending_key = _pending_votes_key(station)
    values = cast(list[str], redis.zrangebyscore(pending_key, "-inf", "+inf"))
    batch_values = [value for value in values if json.loads(value)["batch_id"] == batch_id]
    if not batch_values:
        return

    votes = [json.loads(value) for value in batch_values]
    counts = Counter(vote["bus_type"] for vote in votes)
    highest_count = max(counts.values())
    winners = [bus_type for bus_type, count in counts.items() if count == highest_count]

    # 동률은 잘못된 출발 제보를 확정하지 않기 위해 반영하지 않는다.
    if len(winners) == 1:
        finalized = redis.set(
            _finalized_vote_key(station, batch_id),
            "1",
            nx=True,
            ex=DEPARTURE_VALID_SECONDS,
        )
        if finalized:
            now = datetime.now(timezone(timedelta(hours=9)))
            confirmed_departure = {
                "id": str(uuid4()),
                "station": station,
                "bus_type": winners[0],
                "reported_at": now.isoformat(),
            }
            _store_confirmed_departure(confirmed_departure, now.timestamp())

    redis.zrem(pending_key, *batch_values)


def _finalize_expired_votes(station: str) -> None:
    active_batch_id = redis.get(_vote_window_key(station))
    values = cast(list[str], redis.zrangebyscore(_pending_votes_key(station), "-inf", "+inf"))
    batch_ids = {json.loads(value)["batch_id"] for value in values}
    for batch_id in batch_ids:
        if batch_id != active_batch_id:
            _finalize_vote_batch(station, batch_id)


def _schedule_vote_finalization(station: str, batch_id: str) -> None:
    timer = Timer(DEPARTURE_VOTE_WINDOW_SECONDS, _finalize_vote_batch, args=(station, batch_id))
    timer.daemon = True
    timer.start()


def set_departure(report: DepartureCreate, idempotency_key: str | None = None):
    if idempotency_key:
        cached = redis.get(f"departure_idempotency:{idempotency_key}")
        if cached:
            return json.loads(cached)

    cooldown_key = _cooldown_key(report.station, report.device_id)
    cooldown_created = redis.set(
        cooldown_key,
        "1",
        nx=True,
        ex=DEPARTURE_COOLDOWN_SECONDS,
    )
    if not cooldown_created:
        retry_after = redis.ttl(cooldown_key)
        raise DepartureCooldownError(
            max(int(retry_after), 0),
            "잠시 후 다시 출발 제보할 수 있습니다.",
        )

    vote_window_key = _vote_window_key(report.station)
    batch_id = redis.get(vote_window_key)
    starts_vote_window = False
    if not batch_id:
        candidate_batch_id = str(uuid4())
        starts_vote_window = redis.set(
            vote_window_key,
            candidate_batch_id,
            nx=True,
            ex=DEPARTURE_VOTE_WINDOW_SECONDS,
        )
        batch_id = candidate_batch_id if starts_vote_window else redis.get(vote_window_key)

    now = datetime.now(timezone(timedelta(hours=9)))
    stored_vote = {
        "id": str(uuid4()),
        "batch_id": batch_id,
        "station": report.station,
        "bus_type": report.bus_type,
        "device_id": report.device_id,
        "reported_at": now.isoformat(),
    }

    try:
        redis.zadd(_pending_votes_key(report.station), {json.dumps(stored_vote): now.timestamp()})
        if starts_vote_window:
            _schedule_vote_finalization(report.station, batch_id)
    except Exception:
        redis.delete(cooldown_key)
        raise

    response = {
        "id": stored_vote["id"],
        "station": stored_vote["station"],
        "bus_type": stored_vote["bus_type"],
        "status": "pending",
        "vote_window_seconds": DEPARTURE_VOTE_WINDOW_SECONDS,
    }
    if idempotency_key:
        redis.set(
            f"departure_idempotency:{idempotency_key}",
            json.dumps(response),
            ex=IDEMPOTENCY_TTL_SECONDS,
        )
    return response


def get_latest_departure(station: str):
    _finalize_expired_votes(OPPOSITE_STATIONS[station])
    timestamp = time.time()
    key = _departures_key(station)
    redis.zremrangebyscore(key, "-inf", timestamp - DEPARTURE_VALID_SECONDS)
    values = cast(
        list[str],
        redis.zrangebyscore(key, timestamp - DEPARTURE_VALID_SECONDS, "+inf"),
    )
    if not values:
        return None

    latest = json.loads(values[-1])
    return {
        "bus_type": latest["bus_type"],
        "origin_name": STATION_NAMES[latest["station"]],
        "eta_text": "방금 출발 제보가 들어왔어요.",
        "queue_reduction": BUS_QUEUE_REDUCTIONS[latest["bus_type"]],
        "reported_at": latest["reported_at"],
    }


def get_latest_queue_reduction(station: str):
    _finalize_expired_votes(station)
    timestamp = time.time()
    key = _queue_reductions_key(station)
    redis.zremrangebyscore(key, "-inf", timestamp - DEPARTURE_VALID_SECONDS)
    values = cast(
        list[str],
        redis.zrangebyscore(key, timestamp - DEPARTURE_VALID_SECONDS, "+inf"),
    )
    if not values:
        return None

    latest = json.loads(values[-1])
    return BUS_QUEUE_REDUCTIONS[latest["bus_type"]]
