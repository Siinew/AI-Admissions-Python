// ========== Session Logic ==========

// Generate or retrieve session ID (also sets cookie for cross-tab persistence)
function getOrCreateSessionId() {
  const key = 'ai_session_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
    document.cookie = `ai_session_id=${id}; path=/; max-age=2592000`;
  }
  return id;
}

const SESSION_ID = getOrCreateSessionId();
let sessionMetadataSent = false;

// Helper to get UTM and browser environment
function getUrlParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

function getSessionMetadata() {
  return {
    browser_name: navigator.userAgentData?.brands?.[0]?.brand || navigator.appName,
    browser_version: navigator.userAgentData?.brands?.[0]?.version || navigator.appVersion,
    os_name: navigator.platform || "unknown",
    os_version: "unknown",
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    referrer: document.referrer || null,
    utm_source: getUrlParam("utm_source"),
    utm_medium: getUrlParam("utm_medium"),
    utm_campaign: getUrlParam("utm_campaign"),
    utm_term: getUrlParam("utm_term"),
    utm_content: getUrlParam("utm_content")
  };
}

// Optional geo enrichment (runs once)
async function fetchGeoData() {
  try {
    const res = await fetch("https://ipinfo.io/json?token=demo");
    if (!res.ok) throw new Error("Geo service failed");
    const geo = await res.json();
    return {
      geo_country: geo.country,
      geo_city: geo.city
    };
  } catch (err) {
    console.warn("🌐 Geo enrichment skipped:", err.message);
    return {};
  }
}

// Sends initial metadata with first query
async function sendSessionMetadata(queryText) {
  if (sessionMetadataSent) return;

  const meta = getSessionMetadata();
  const geo = await fetchGeoData();
  const payload = {
    query: queryText,
    persona_id: "Adam",
    session_id: SESSION_ID,
    metadata: { ...meta, ...geo }
  };

  try {
    await fetch("http://localhost:8001/api/query", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    sessionMetadataSent = true;
  } catch (err) {
    console.error("🛑 Failed to send session metadata:", err);
  }
}

// One-time metadata payload grab for query
function getMetadataPayloadOnce() {
  if (sessionMetadataSent) return null;
  sessionMetadataSent = true;
  return getSessionMetadata();
}

// ========== Click Logging ==========

let clickLog = [];

document.addEventListener('click', e => {
  const path = e.composedPath?.() || e.path || [];
  const target = path[0] || e.target;
  const label = target?.id || target?.innerText?.slice(0, 50) || "unknown";
  clickLog.push({ label, time: new Date().toISOString() });

  if (clickLog.length >= 20) flushClickData();
});

function flushClickData() {
  if (clickLog.length === 0) return;

  fetch("http://localhost:8001/api/session-clicks", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: SESSION_ID,
      clicks: [...clickLog]
    })
  });

  clickLog = [];
}

// ========== Mouse Movement Logging ==========

let moveLog = [];

document.addEventListener("mousemove", e => {
  moveLog.push({
    x: e.clientX,
    y: e.clientY,
    t: Date.now()
  });

  if (moveLog.length >= 50) flushMoveData();
});

function flushMoveData() {
  if (moveLog.length === 0) return;

  fetch("http://localhost:8001/api/session-move", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: SESSION_ID,
      moves: [...moveLog]
    })
  }).catch(err => {
    console.error("❌ Failed to flush mousemove data:", err);
  });

  moveLog = [];
}

// ========== Unload Hook ==========

window.addEventListener("beforeunload", () => {
  flushClickData();
  flushMoveData();
});
