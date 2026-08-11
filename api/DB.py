import os
from fastapi import FastAPI
from upstash_redis import Redis
from dotenv import load_dotenv

# 1. 비서(dotenv)를 시켜서 .env 파일의 내용을 파이썬으로 불러옵니다.
load_dotenv()

app = FastAPI()

# 2. 불러온 URL과 TOKEN을 꺼내서 Redis DB에 연결합니다.
redis = Redis(
    url=os.getenv("UPSTASH_REDIS_REST_URL"),
    token=os.getenv("UPSTASH_REDIS_REST_TOKEN")
)

# 연결 테스트용 API
