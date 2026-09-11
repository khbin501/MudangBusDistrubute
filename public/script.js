const API_BASE = "/api/v1";
const STATIONS = {
    semiconductor: { name: "반도체대학 앞", opposite: "AI공학관 앞" },
    ai_engineering: { name: "AI공학관 앞", opposite: "반도체대학 앞" },
};

const LEVELS = {
    1: { label: "바로 탑승 가능", range: "0~20명", color: "#136b4a", soft: "#dff2e9" },
    2: { label: "여유", range: "20~40명", color: "#28704f", soft: "#e4f0e8" },
    3: { label: "보통", range: "40~60명", color: "#9a641c", soft: "#f8edd8" },
    4: { label: "혼잡", range: "60~80명", color: "#a44b13", soft: "#fbe8d9" },
    5: { label: "매우 혼잡", range: "100명+", color: "#a73532", soft: "#f9e2e0" },
};

const BUS_NAMES = { small: "작은 무당이", large: "큰 무당이", white: "흰둥이" };
const LINE_REPORT_COOLDOWN_SECONDS = 30;
const LINE_REPORT_COOLDOWN_UNTIL_KEY_PREFIX = "mudang_line_report_cooldown_until";
const DEPARTURE_COOLDOWN_SECONDS = 3 * 60;
const DEPARTURE_COOLDOWN_UNTIL_KEY_PREFIX = "mudang_departure_cooldown_until";
const STATUS_AUTO_REFRESH_SECONDS = 60;
const STATUS_MANUAL_REFRESH_COOLDOWN_SECONDS = 30;
const state = {
    station: "semiconductor",
    selectedLevel: null,
    selectedBus: null,
    loading: false,
    demo: false,
    requestSequence: 0,
    statusController: null,
    lineCooldownTimer: null,
    departureCooldownTimer: null,
    statusRefreshUntil: 0,
    manualRefreshUntil: 0,
    statusRefreshTimer: null,
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
    autoRefreshCounter: document.querySelector("#auto-refresh-counter"),
    busAlert: document.querySelector("#bus-alert"),
    incomingTitle: document.querySelector("#incoming-title"),
    incomingDetail: document.querySelector("#incoming-detail"),
    notice: document.querySelector("#global-notice"),
    infoButtons: [...document.querySelectorAll(".info-button")],
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
    return id; // random UUID 반환 , device id는 브라우저 내부에 저장됨
}

function makeIdempotencyKey(type) {
    const random = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2);
    return `${type}-${Date.now()}-${random}`; //다른 객체 UUID 활용해서 IdempotencyKey 생성
}

function setNotice(message = "", type = "info") {
    elements.notice.textContent = message;
    elements.notice.className = `notice ${message ? "show" : ""} ${type}`;
}

function setLoading(isLoading) {
    state.loading = isLoading;
    updateStatusRefreshButton();
}

function getStatusRefreshRemaining() {
    return Math.max(0, Math.ceil((state.statusRefreshUntil - Date.now()) / 1000));
}

function getManualRefreshRemaining() {
    return Math.max(0, Math.ceil((state.manualRefreshUntil - Date.now()) / 1000));
}

function updateStatusRefreshButton() {
    const autoRefreshRemaining = getStatusRefreshRemaining();
    if (document.hidden) {
        elements.autoRefreshCounter.textContent = "자동 새로고침 일시 정지";
    } else if (state.loading) {
        elements.autoRefreshCounter.textContent = "자동 새로고침 갱신 중";
    } else {
        elements.autoRefreshCounter.textContent = autoRefreshRemaining > 0
            ? `${autoRefreshRemaining}s`
            : "자동 새로고침 준비 중";
    }

    if (state.loading) {
        elements.refresh.disabled = true;
        elements.refresh.textContent = "불러오는 중…";
        return;
    }

    const remaining = getManualRefreshRemaining();
    elements.refresh.disabled = remaining > 0;
    elements.refresh.textContent = remaining > 0 ? `${remaining}초 후에 새로고침 가능해요` : "↻ 지금 새로고침";
}

function clearStatusRefreshTimer() {
    if (state.statusRefreshTimer) {
        window.clearInterval(state.statusRefreshTimer);
        state.statusRefreshTimer = null;
    }
}

function scheduleNextStatusRefresh() {
    clearStatusRefreshTimer();
    state.statusRefreshUntil = Date.now() + STATUS_AUTO_REFRESH_SECONDS * 1000;
    state.statusRefreshTimer = window.setInterval(() => {
        if (getStatusRefreshRemaining() > 0) {
            updateStatusRefreshButton();
            return;
        }

        clearStatusRefreshTimer();
        state.statusRefreshUntil = 0;
        updateStatusRefreshButton();
        if (!document.hidden) loadStatus({ quiet: true });
    }, 250);
    updateStatusRefreshButton();
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

function formatDepartureTime(value) {
    const time = new Date(value);
    if (Number.isNaN(time)) return "출발 시각 알 수 없음";

    const parts = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).formatToParts(time);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part("month")}월 ${part("day")}일 ${part("dayPeriod")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function confidenceLabel(value) {
    return { high: "신뢰도 높음", medium: "신뢰도 보통", low: "신뢰도 낮음" }[value] || "정보 부족";
}

function renderStatus(data) {
    const level = Number(data.level);
    const levelInfo = LEVELS[Math.min(5, Math.max(1, Math.ceil(level)))];
    elements.stationName.textContent = STATIONS[state.station].name;
    elements.currentLevel.textContent = levelInfo ? Number.isInteger(level) ? level : level.toFixed(1) : "—";
    elements.statusCopy.textContent = data.message || (levelInfo ? `${levelInfo.label} · ${levelInfo.range}` : "현재 정보가 없어요");
    elements.confidence.textContent = confidenceLabel(data.confidence);
    elements.updatedAt.textContent = relativeTime(data.updated_at);
    elements.reportCount.textContent = `10분 이내의 제보 ${Number(data.report_count) || 0}건`;
    const color = levelInfo?.color || "#66716d";
    const soft = levelInfo?.soft || "#ecece7";
    elements.statusCard.style.setProperty("--status-color", color);
    elements.statusCard.style.setProperty("--status-soft", soft);
    elements.currentLevel.style.color = color;

    const bus = data.incoming_bus;
    if (bus?.bus_type) {
        const origin = bus.origin_name || STATIONS[state.station].opposite;
        elements.incomingTitle.textContent = `${origin}에서 ${BUS_NAMES[bus.bus_type] || "버스"}가 출발했어요`;
        elements.incomingDetail.textContent = bus.reported_at
            ? `${formatDepartureTime(bus.reported_at)} 출발 제보`
            : bus.eta_text || "출발 제보 시각을 알 수 없어요.";
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
        const detail = payload.detail;
        const message = typeof detail === "object" ? detail.message : detail;
        const error = new Error(message || payload.message || "요청을 처리하지 못했습니다.");
        error.status = response.status;
        error.retryAfter = typeof detail === "object" ? detail.retry_after : null;
        throw error;
    }
    return payload;
}

function getLineReportCooldownUntilKey(station = state.station) {
    return `${LINE_REPORT_COOLDOWN_UNTIL_KEY_PREFIX}:${station}`;
}

function getLineReportCooldownRemaining(station = state.station) {
    const cooldownUntil = Number(localStorage.getItem(getLineReportCooldownUntilKey(station)));
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

function updateLineReportButton() {
    const remaining = getLineReportCooldownRemaining();
    if (remaining > 0) {
        if (!state.lineCooldownTimer) {
            state.lineCooldownTimer = window.setInterval(updateLineReportButton, 250);
        }
        elements.lineSubmit.disabled = true;
        elements.lineSubmit.textContent = `${remaining}초 후 다시 제보 가능`;
        return;
    }

    localStorage.removeItem(getLineReportCooldownUntilKey());
    if (state.lineCooldownTimer) {
        window.clearInterval(state.lineCooldownTimer);
        state.lineCooldownTimer = null;
    }
    elements.lineSubmit.disabled = !state.selectedLevel;
    elements.lineSubmit.textContent = "대기열 제보 보내기";
}

function startLineReportCooldown(seconds = LINE_REPORT_COOLDOWN_SECONDS, station = state.station) {
    const safeSeconds = Math.max(1, Number(seconds) || LINE_REPORT_COOLDOWN_SECONDS);
    localStorage.setItem(getLineReportCooldownUntilKey(station), String(Date.now() + safeSeconds * 1000));
    if (!state.lineCooldownTimer) {
        state.lineCooldownTimer = window.setInterval(updateLineReportButton, 250);
    }
    updateLineReportButton();
}

function getDepartureCooldownUntilKey(station = state.station) {
    return `${DEPARTURE_COOLDOWN_UNTIL_KEY_PREFIX}:${station}`;
}

function getDepartureCooldownRemaining(station = state.station) {
    const cooldownUntil = Number(localStorage.getItem(getDepartureCooldownUntilKey(station)));
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

function updateDepartureButton() {
    const remaining = getDepartureCooldownRemaining();
    if (remaining > 0) {
        if (!state.departureCooldownTimer) {
            state.departureCooldownTimer = window.setInterval(updateDepartureButton, 250);
        }
        elements.departureSubmit.disabled = true;
        elements.departureSubmit.textContent = `${remaining}초 후 다시 제보 가능`;
        return;
    }

    localStorage.removeItem(getDepartureCooldownUntilKey());
    if (state.departureCooldownTimer) {
        window.clearInterval(state.departureCooldownTimer);
        state.departureCooldownTimer = null;
    }
    elements.departureSubmit.disabled = !state.selectedBus;
    elements.departureSubmit.textContent = "출발 제보 보내기";
}

function startDepartureCooldown(seconds = DEPARTURE_COOLDOWN_SECONDS, station = state.station) {
    const safeSeconds = Math.max(1, Number(seconds) || DEPARTURE_COOLDOWN_SECONDS);
    localStorage.setItem(getDepartureCooldownUntilKey(station), String(Date.now() + safeSeconds * 1000));
    if (!state.departureCooldownTimer) {
        state.departureCooldownTimer = window.setInterval(updateDepartureButton, 250);
    }
    updateDepartureButton();
}

async function loadStatus({ quiet = false } = {}) {
    clearStatusRefreshTimer();
    state.statusRefreshUntil = 0;
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
            scheduleNextStatusRefresh();
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
    updateLineReportButton();
    updateDepartureButton();
    elements.levelHelp.textContent = "단계를 선택하면 설명이 표시됩니다.";
    loadStatus();
}

function selectLevel(level) {
    state.selectedLevel = level;
    elements.levelOptions.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.level) === level)));
    elements.levelHelp.textContent = `${LEVELS[level].label} · ${LEVELS[level].range}`;
    updateLineReportButton();
}

function selectBus(bus) {
    state.selectedBus = bus;
    elements.busOptions.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.bus === bus)));
    updateDepartureButton();
}

async function submitLineReport() {
    if (!state.selectedLevel) return;
    // if (state.demo) {
    //     setNotice(`대기열 ${state.selectedLevel}단계 제보 화면이 정상 동작합니다. API 구현 후 실제 저장됩니다.`, "success");
    //     return;
    // }
    elements.lineSubmit.disabled = true;
    elements.lineSubmit.textContent = "제보 보내는 중…";
    try {
        await request("/line-reports", { method: "POST", headers: { "Idempotency-Key": makeIdempotencyKey("line") }, body: JSON.stringify({ station_name: state.station, congestion_level: state.selectedLevel, device_id: getDeviceId() }) });
        startLineReportCooldown();
        setNotice("대기열 제보가 반영됐어요. 고맙습니다!", "success");
        await loadStatus({ quiet: true });
    } catch (error) {
        const retryAfter = Number(error.retryAfter) || LINE_REPORT_COOLDOWN_SECONDS;
        if (error.status === 429) startLineReportCooldown(retryAfter);
        setNotice(error.status === 429 ? `${retryAfter}초 후 다시 제보해주세요.` : error.message, "error");
    } finally {
        updateLineReportButton();
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
        const result = await request("/departures", { method: "POST", headers: { "Idempotency-Key": makeIdempotencyKey("departure") }, body: JSON.stringify({ station: state.station, bus_type: state.selectedBus, device_id: getDeviceId() }) });
        startDepartureCooldown();
        setNotice(`출발 제보를 확인 중이에요. ${result.vote_window_seconds}초 뒤  반영됩니다.`, "success");
        await loadStatus({ quiet: true });
        window.setTimeout(() => loadStatus({ quiet: true }), (result.vote_window_seconds + 1) * 1000);
    } catch (error) {
        const retryAfter = Number(error.retryAfter) || DEPARTURE_COOLDOWN_SECONDS;
        if (error.status === 429) startDepartureCooldown(retryAfter);
        setNotice(error.message, "error");
    } finally {
        updateDepartureButton();
    }
}

elements.tabs.forEach((tab) => tab.addEventListener("click", () => selectStation(tab.dataset.station)));
elements.infoButtons.forEach((button) => button.addEventListener("click", () => {
    const panel = document.querySelector(`#${button.dataset.infoTarget}`);
    const isExpanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isExpanded));
    panel.hidden = isExpanded;
}));
elements.levelOptions.forEach((button) => button.addEventListener("click", () => selectLevel(Number(button.dataset.level))));
elements.busOptions.forEach((button) => button.addEventListener("click", () => selectBus(button.dataset.bus)));
elements.refresh.addEventListener("click", () => {
    state.manualRefreshUntil = Date.now() + STATUS_MANUAL_REFRESH_COOLDOWN_SECONDS * 1000;
    loadStatus();
});
elements.lineSubmit.addEventListener("click", submitLineReport);
elements.departureSubmit.addEventListener("click", submitDeparture);

updateLineReportButton();
updateDepartureButton();
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        clearStatusRefreshTimer();
        state.statusRefreshUntil = 0;
        updateStatusRefreshButton();
        return;
    }
    if (!state.loading) loadStatus({ quiet: true });
});
loadStatus();
