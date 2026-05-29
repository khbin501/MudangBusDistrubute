from fastapi import FastAPI

# Vercel 환경에 맞게 Swagger UI 경로 설정
app = FastAPI(docs_url="/api/docs", openapi_url="/api/openapi.json")

@app.get("/api")
def read_root():
    return {"message": "안녕하세요! Vercel 서버리스에서 돌아가는 FastAPI입니다."}

@app.get("/api/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id, "status": "success"}