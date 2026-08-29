from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from .routers.health import health_check
from .routers.line_report import line_report

app = FastAPI()
app.include_router(health_check)
app.include_router(line_report)

public_directory = Path(__file__).resolve().parent.parent / "public"

app.mount("/", StaticFiles(directory=public_directory, html=True), name="public")
