from pydantic import BaseModel

class Report(BaseModel):
    station_name : str
    line_level : int