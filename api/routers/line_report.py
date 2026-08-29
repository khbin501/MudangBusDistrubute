from typing import Literal

from fastapi import APIRouter, Header, HTTPException, status

from .schemas.schemas import LineReportCreate
from .services.line_report import get_station_status, set_line_report

line_report = APIRouter(
    prefix="/api/v1",
    tags=["line_report"]
)

@line_report.post("/line-reports", status_code=status.HTTP_201_CREATED)
def report(
    user_report: LineReportCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        return set_line_report(user_report, idempotency_key)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="제보를 저장하지 못했습니다.") from exc


@line_report.get("/stations/{station_name}/status")
def station_status(station_name: Literal["semiconductor", "ai_engineering"]):
    try:
        return get_station_status(station_name)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="현재 상태를 불러오지 못했습니다.") from exc
