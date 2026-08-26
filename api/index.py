from fastapi import FastAPI
from .routers.db import db_router

app = FastAPI()
app.include_router(db_router)

@app.get("/api/health-check")
def read_api():
    return {"message": "fastapi server health check."}

    


