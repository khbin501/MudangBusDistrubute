from typing import Literal

from pydantic import BaseModel, Field

class LineReportCreate(BaseModel):
    station_name: Literal["semiconductor", "ai_engineering"]
    congestion_level: int = Field(ge=1, le=5)
    device_id: str = Field(min_length=1, max_length=200)
