import os
from fastapi import FastAPI
from upstash_redis import Redis
from dotenv import load_dotenv
# 1. 비서(dotenv)를 시켜서 .env 파일의 내용을 파이썬으로 불러옵니다.
load_dotenv()


# 2. 불러온 URL과 TOKEN을 꺼내서 Redis DB에 연결합니다.
redis = Redis(
    url=os.getenv("DB_URL"),
    token=os.getenv("DB_TOKEN")
)
# 연결 테스트용 API
def read_root():
    try:
        # 1. DB에 테스트용 데이터를 저장해 봅니다.
        redis.set("test_key", "무당이 알리미 DB 연결 대성공!")
        
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
