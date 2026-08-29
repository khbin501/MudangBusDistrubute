from fastapi import APIRouter

from ..database import redis

health_check = APIRouter(
    prefix="/api/v1",
    tags=["health_check"]
)   
@health_check.get("/server-health-check")
def server_check():
    return {"message": "fastapi server health check."}

# db 연결 테스트용 API
@health_check.get("/db-health-check")
def db_check():
    try:
        # 1. DB에 테스트용 데이터를 저장해 봅니다.
        redis.set("test_key", "DB connection succsess!")
        
        # 2. 방금 저장한 데이터를 다시 불러와 봅니다.
        result = redis.get("test_key")
        
        return {
            "status": "success", 
            "message": result
        }
    except Exception as e:
        # 만약 .env 설정이 틀렸거나 연결에 실패하면 에러 메시지를 띄워줍니다.
        return {
            "status": "error", 
            "error_detail": str(e)
        }
