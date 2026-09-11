from fastapi import APIRouter, Header, HTTPException, status

from .schemas.schemas import DepartureCreate
from .services.departure import DepartureCooldownError, set_departure


departure = APIRouter(
    prefix="/api/v1",
    tags=["departure"],
)


@departure.post("/departures", status_code=status.HTTP_201_CREATED)
def report_departure(
    user_report: DepartureCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        return set_departure(user_report, idempotency_key)
    except DepartureCooldownError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "message": exc.message,
                "retry_after": exc.retry_after,
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="출발 제보를 저장하지 못했습니다.") from exc
