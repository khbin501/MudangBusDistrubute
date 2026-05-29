document.getElementById('fetch-btn').addEventListener('click', async () => {
    const resultBox = document.getElementById('result-box');
    resultBox.innerText = "데이터 로딩 중...";

    try {
        // 같은 도메인이므로 상대 경로 '/api'로 바로 요청을 보냅니다.
        const response = await fetch('/api');
        const data = await response.json();
        
        // 백엔드가 준 {"message": "..."} 데이터를 화면에 출력
        resultBox.innerText = data.message;
    } catch (error) {
        resultBox.innerText = "데이터를 가져오는 데 실패했습니다.";
        console.error(error);
    }
});