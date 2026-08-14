const API_BASE = "/api/v1";
const POLL_INTERVAL_MS = 15_000;

const STATIONS = {
    semiconductor: { name: "반도체대학 앞", opposite: "AI공학관 앞" },
    ai_engineering: { name: "AI공학관 앞", opposite: "반도체대학 앞" },
};

const LEVELS = {
    1: { label: "바로 탑승 가능", range: "약 0~5명", color: "#136b4a", soft: "#dff2e9" },
    2: { label: "여유", range: "약 6~10명", color: "#28704f", soft: "#e4f0e8" },
    3: { label: "보통", range: "약 11~20명", color: "#9a641c", soft: "#f8edd8" },
    4: { label: "혼잡", range: "약 21~30명", color: "#a44b13", soft: "#fbe8d9" },
    5: { label: "매우 혼잡", range: "약 31명 이상", color: "#a73532", soft: "#f9e2e0" },
};

const BUS_NAMES = { small: "작은무당이", large: "큰무당이", white: "흰둥이" };
const state = {
    station: "semiconductor",
    selectedLevel: null,
    selectedBus: null,
    loading: false,
    demo: false,
    requestSequence: 0,
    statusController: null,
};

const elements = {
    tabs: [...document.querySelectorAll(".station-tab")],
    stationName: document.querySelector("#station-name"),
    statusCard: document.querySelector("#status-card"),
    currentLevel: document.querySelector("#current-level"),
    statusCopy: document.querySelector("#status-copy"),
    confidence: document.querySelector("#confidence-badge"),
    updatedAt: document.querySelector("#updated-at"),
    reportCount: document.querySelector("#report-count"),
    refresh: document.querySelector("#refresh-button"),
    busAlert: document.querySelector("#bus-alert"),
    incomingTitle: document.querySelector("#incoming-title"),
    incomingDetail: document.querySelector("#incoming-detail"),
    notice: document.querySelector("#global-notice"),
    levelOptions: [...document.querySelectorAll(".level-option")],
    levelHelp: document.querySelector("#level-help"),
    lineSubmit: document.querySelector("#line-submit"),
    busOptions: [...document.querySelectorAll(".bus-option")],
    departureSubmit: document.querySelector("#departure-submit"),
    demoNote: document.querySelector("#demo-note"),
};

function getDeviceId() {
    const storageKey = "mudang_device_id";
    let id = localStorage.getItem(storageKey);
    if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(storageKey, id);
    }
    return id;
}

function makeIdempotencyKey(type) {
    const random = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2);
    return `${type}-${Date.now()}-${random}`;
}

function setNotice(message = "", type = "info") {
    elements.notice.textContent = message;
    elements.notice.className = `notice ${message ? "show" : ""} ${type}`;
}

function setLoading(isLoading) {
    state.loading = isLoading;
    elements.refresh.disabled = isLoading;
    elements.refresh.textContent = isLoading ? "불러오는 중…" : "↻ 지금 새로고침";
}

function relativeTime(value) {
    if (!value) return "마지막 제보 없음";
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return "갱신 시각 알 수 없음";
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 30) return "방금 전 제보";
    if (seconds < 60) return `${seconds}초 전 제보`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}분 전 제보`;
    return "오래된 제보";
}

function confidenceLabel(value) {
    return { high: "신뢰도 높음", medium: "신뢰도 보통", low: "신뢰도 낮음" }[value] || "정보 부족";
}

function renderStatus(data) {
    const level = Number(data.level);
    const levelInfo = LEVELS[level];
    elements.stationName.textContent = STATIONS[state.station].name;
    elements.currentLevel.textContent = levelInfo ? level : "—";
    elements.statusCopy.textContent = data.message || (levelInfo ? `${levelInfo.label} · ${levelInfo.range}` : "현재 정보가 없어요");
    elements.confidence.textContent = confidenceLabel(data.confidence);
    elements.updatedAt.textContent = relativeTime(data.updated_at);
    elements.reportCount.textContent = `유효 제보 ${Number(data.report_count) || 0}건`;
    const color = levelInfo?.color || "#66716d";
    const soft = levelInfo?.soft || "#ecece7";
    elements.statusCard.style.setProperty("--status-color", color);
    elements.statusCard.style.setProperty("--status-soft", soft);
    elements.currentLevel.style.color = color;

    const bus = data.incoming_bus;
    if (bus?.bus_type) {
        const origin = bus.origin_name || STATIONS[state.station].opposite;
        elements.incomingTitle.textContent = `${origin}에서 ${BUS_NAMES[bus.bus_type] || "버스"}가 출발했어요`;
        elements.incomingDetail.textContent = bus.eta_text || "잠시 후 도착할 예정이에요.";
        elements.busAlert.hidden = false;
    } else {
        elements.busAlert.hidden = true;
    }
}

function demoStatus() {
    state.demo = true;
    elements.demoNote.hidden = false;
    return {
        level: state.station === "semiconductor" ? 3 : null,
        confidence: state.station === "semiconductor" ? "medium" : "low",
        report_count: state.station === "semiconductor" ? 2 : 0,
        updated_at: state.station === "semiconductor" ? new Date(Date.now() - 70_000).toISOString() : null,
        message: state.station === "semiconductor" ? null : "아직 최근 제보가 없어요",
        incoming_bus: state.station === "semiconductor" ? { bus_type: "large", eta_text: "약 3~5분 뒤 도착 예정이에요." } : null,
    };
}

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* empty response */ }
    if (!response.ok) {
        const error = new Error(payload.detail || payload.message || "요청을 처리하지 못했습니다.");
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function loadStatus({ quiet = false } = {}) {
    const requestedStation = state.station;
    const requestSequence = ++state.requestSequence;
    state.statusController?.abort();
    const controller = new AbortController();
    state.statusController = controller;
    setLoading(true);
    if (!quiet) setNotice();
    try {
        const data = await request(`/stations/${requestedStation}/status`, { signal: controller.signal });
        if (requestSequence !== state.requestSequence || requestedStation !== state.station) return;
        state.demo = false;
        elements.demoNote.hidden = true;
        renderStatus(data);
    } catch (error) {
        if (error.name === "AbortError") return;
        if (requestSequence !== state.requestSequence || requestedStation !== state.station) return;
        if (error.status === 404 || error instanceof TypeError) {
            renderStatus(demoStatus());
            if (!quiet) setNotice("백엔드 연결 전이라 예시 데이터로 화면을 보여드리고 있어요.", "info");
        } else {
            renderStatus({ level: null, confidence: "low", report_count: 0, updated_at: null, message: "현재 정보를 불러오지 못했어요" });
            if (!quiet) setNotice(error.message, "error");
        }
    } finally {
        if (requestSequence === state.requestSequence) {
            state.statusController = null;
            setLoading(false);
        }
    }
}

function selectStation(station) {
    if (!STATIONS[station]) return;
    state.station = station;
    state.selectedLevel = null;
    state.selectedBus = null;
    elements.tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.station === station)));
    elements.stationName.textContent = STATIONS[station].name;
    elements.currentLevel.textContent = "—";
    elements.statusCopy.textContent = "현재 정보를 불러오고 있어요";
    elements.confidence.textContent = "확인 중";
    elements.updatedAt.textContent = "잠시만 기다려주세요";
    elements.reportCount.textContent = "유효 제보 —건";
    elements.busAlert.hidden = true;
    elements.levelOptions.forEach((button) => button.setAttribute("aria-pressed", "false"));
    elements.busOptions.forEach((button) => button.setAttribute("aria-pressed", "false"));
    elements.lineSubmit.disabled = true;
    elements.departureSubmit.disabled = true;
    elements.levelHelp.textContent = "단계를 선택하면 설명이 표시됩니다.";
    loadStatus();
}

function selectLevel(level) {
    state.selectedLevel = level;
    elements.levelOptions.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.level) === level)));
    elements.levelHelp.textContent = `${LEVELS[level].label} · ${LEVELS[level].range}`;
    elements.lineSubmit.disabled = false;
}

function selectBus(bus) {
    state.selectedBus = bus;
    elements.busOptions.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.bus === bus)));
    elements.departureSubmit.disabled = false;
}

async function submitLineReport() {
    if (!state.selectedLevel) return;
    if (state.demo) {
        setNotice(`대기열 ${state.selectedLevel}단계 제보 화면이 정상 동작합니다. API 구현 후 실제 저장됩니다.`, "success");
        return;
    }
    elements.lineSubmit.disabled = true;
    elements.lineSubmit.textContent = "제보 보내는 중…";
    try {
        await request("/line-reports", { method: "POST", headers: { "Idempotency-Key": makeIdempotencyKey("line") }, body: JSON.stringify({ station: state.station, level: state.selectedLevel, device_id: getDeviceId() }) });
        setNotice("대기열 제보가 반영됐어요. 고맙습니다!", "success");
        await loadStatus({ quiet: true });
    } catch (error) {
        setNotice(error.status === 429 ? "잠시 후 다시 제보해주세요." : error.message, "error");
    } finally {
        elements.lineSubmit.disabled = false;
        elements.lineSubmit.textContent = "대기열 제보 보내기";
    }
}

async function submitDeparture() {
    if (!state.selectedBus) return;
    if (state.demo) {
        setNotice(`${BUS_NAMES[state.selectedBus]} 출발 제보 화면이 정상 동작합니다. API 구현 후 실제 저장됩니다.`, "success");
        return;
    }
    elements.departureSubmit.disabled = true;
    elements.departureSubmit.textContent = "제보 보내는 중…";
    try {
        await request("/departures", { method: "POST", headers: { "Idempotency-Key": makeIdempotencyKey("departure") }, body: JSON.stringify({ station: state.station, bus_type: state.selectedBus, device_id: getDeviceId() }) });
        setNotice("버스 출발 제보가 반영됐어요. 고맙습니다!", "success");
        await loadStatus({ quiet: true });
    } catch (error) {
        setNotice(error.status === 429 ? "잠시 후 다시 제보해주세요." : error.message, "error");
    } finally {
        elements.departureSubmit.disabled = false;
        elements.departureSubmit.textContent = "출발 제보 보내기";
    }
}

elements.tabs.forEach((tab) => tab.addEventListener("click", () => selectStation(tab.dataset.station)));
elements.levelOptions.forEach((button) => button.addEventListener("click", () => selectLevel(Number(button.dataset.level))));
elements.busOptions.forEach((button) => button.addEventListener("click", () => selectBus(button.dataset.bus)));
elements.refresh.addEventListener("click", () => loadStatus());
elements.lineSubmit.addEventListener("click", submitLineReport);
elements.departureSubmit.addEventListener("click", submitDeparture);

loadStatus();
setInterval(() => loadStatus({ quiet: true }), POLL_INTERVAL_MS);
