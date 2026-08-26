from pydantic import BaseModel, Field

class LineReportCreate(BaseModel):
    station_name : str
    congestion_level : int = Field(le=1, ge=5)
    device_id : str