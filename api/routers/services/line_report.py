from ..schemas.schemas import LineReportCreate

def set_line_report(report : LineReportCreate):
    station_name = report.station_name
    congestion_level = report.congestion_level
    device_id = report.device_id
    return {"get_station_name": station_name, "congestion_level" : congestion_level, 
            "device_id" : device_id}