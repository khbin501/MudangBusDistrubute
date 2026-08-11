from fastapi import FastAPI
from fastapi.responses import FileResponse
import os

app = FastAPI()

# 현재 실행 중인 파일(api/index.py)의 부모 폴더(최상위 디렉토리) 경로 계산
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

@app.get("/api")
def read_api():
    return {"message": "안녕하세요! Vercel 서버리스에서 돌아가는 FastAPI입니다."}

# [추가] 메인 주소(/)로 접속하면 무당이 알리미 HTML 띄워주기
@app.get("/")
def serve_html():
    html_path = os.path.join(BASE_DIR, "index.html")
    return FileResponse(html_path)

# [추가] HTML이 자바스크립트 파일을 요구할 때 전달해주기
@app.get("/script.js")
def serve_js():
    js_path = os.path.join(BASE_DIR, "script.js")
    return FileResponse(js_path)

@app.get("/db")
def read_root():
    return {"message": "DB 연결 세팅 완료!"}