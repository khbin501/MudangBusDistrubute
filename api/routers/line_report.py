from fastapi import APIRouter
from ..routers.schemas.schemas import LineReportCreate
from ..routers.services.line_report import set_line_report



line_report = APIRouter(
    prefix="/api/v1",
    tags=["line_report"]
)

@line_report.get("/line-report")
def report(user_report : LineReportCreate):
    return set_line_report