from fastapi import FastAPI
from .routers.health import health_check
from .routers.line_report import line_report

app = FastAPI()
app.include_router(health_check)
app.include_router(line_report)

    
    


