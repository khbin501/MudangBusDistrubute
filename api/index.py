from fastapi import FastAPI
from .routers.health import health_check

app = FastAPI()
app.include_router(health_check)



    


