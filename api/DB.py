import os
from upstash_redis import Redis
from dotenv import load_dotenv

load_dotenv()

redis = Redis.from_env()

redis.set("foo", "bar")
value = redis.get("foo")