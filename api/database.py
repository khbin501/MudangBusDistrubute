import os

from dotenv import load_dotenv
from upstash_redis import Redis


load_dotenv()

db_url = os.getenv("DB_URL")
db_token = os.getenv("DB_TOKEN")

if not db_url or not db_token:
    raise ValueError("DB_URL 또는 DB_TOKEN 환경변수가 없습니다.")

redis = Redis(url=db_url, token=db_token)
