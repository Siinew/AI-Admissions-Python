from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client
import openai
import os
import datetime
import requests

# Load .env
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GLOBAL_PROMPT_KEY = os.getenv("GLOBAL_PROMPT_KEY")

if not GLOBAL_PROMPT_KEY:
    raise ValueError("❌ Missing GLOBAL_PROMPT_KEY in .env")

# Init
app = FastAPI()

# Add CORS middleware immediately after initializing FastAPI
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:8001",
        "http://127.0.0.1:8001"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
openai.api_key = OPENAI_API_KEY

# 🌐 Optional Geo lookup
def get_geo_data(ip_address: str):
    try:
        print(f"🌐 Performing geo lookup for IP: {ip_address}")
        response = requests.get(f"https://ipapi.co/{ip_address}/json/", timeout=2)
        if response.status_code == 200:
            data = response.json()
            country = data.get("country_name")
            city = data.get("city")
            print(f"🌍 Geo response: country={country}, city={city}")
            return {
                "geo_country": country,
                "geo_city": city
            }
        else:
            print(f"⚠️ Geo API returned status {response.status_code}: {response.text}")
    except Exception as e:
        print("🌐 Geo lookup failed:", repr(e))
    return {}

# 📬 Query AI
@app.post("/api/query")
async def query(request: Request):
    body = await request.json()
    query_text = body.get("query")
    persona_id = body.get("persona_id", "default")
    session_id = body.get("session_id")
    metadata = body.get("metadata", {})

# 🔐 Ensure session is created in DB
    supabase.table("sessions").upsert({
    "session_id": session_id,
    "last_active": datetime.datetime.now(datetime.timezone.utc).isoformat()
}, on_conflict="session_id").execute()

    # 🌐 Handle geo IP fallback for localhost testing
    client_ip = request.client.host
    print("🌐 Original client IP:", client_ip)

    if client_ip in ("127.0.0.1", "::1"):
        client_ip = "8.8.8.8"
    print("📡 Using IP for geo lookup:", client_ip)

    geo_info = get_geo_data(client_ip)
    print("🌎 Geo info returned:", geo_info)
    if geo_info.get("geo_country"):
        metadata["geo_country"] = geo_info["geo_country"]
    if geo_info.get("geo_city"):
        metadata["geo_city"] = geo_info["geo_city"]

    metadata.update(geo_info)


    supabase.table("conversation_history").insert({
        "session_id": session_id,
        "message": query_text,
        "sender": "user",
        "browser_name": metadata.get("browser_name"),
        "browser_version": metadata.get("browser_version"),
        "os_name": metadata.get("os_name"),
        "os_version": metadata.get("os_version"),
        "screen_resolution": metadata.get("screen_resolution"),
        "referrer": metadata.get("referrer"),
        "utm_source": metadata.get("utm_source"),
        "utm_medium": metadata.get("utm_medium"),
        "utm_campaign": metadata.get("utm_campaign"),
        "utm_term": metadata.get("utm_term"),
        "utm_content": metadata.get("utm_content"),
        "geo_country": metadata.get("geo_country"),
        "geo_city": metadata.get("geo_city"),
        "session_metadata": metadata
    }).execute()

    response = supabase.rpc("get_persona_with_global", {
        "persona_id_input": persona_id,
        "prompt_key": GLOBAL_PROMPT_KEY
    }).execute()

    if not response.data:
        return {"error": f"No data found for persona '{persona_id}'."}

    result = response.data[0]
    full_system_prompt = f"{result['global_prefix']}\n\n{result['system_prompt']}"

    embedding_response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query_text
    )
    query_embedding = embedding_response.data[0].embedding

    match_result = supabase.rpc("match_ai_admissions_trainingdata", {
        "query_embedding": query_embedding,
        "match_count": 3
    }).execute()

    context_chunks = "\n\n".join([match["text"] for match in match_result.data])
    full_system_prompt += "\n\nAlways offer visuals with [SHOW_OFFER:slideshow,video,syllabus:wfa] when the user asks for pictures or slides."

    messages = [
        {"role": "system", "content": full_system_prompt},
        {"role": "user", "content": f"Context:\n{context_chunks}\n\nQuestion: {query_text}"}
    ]

    chat_response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages
    )
    raw_response = chat_response.choices[0].message.content

    visual_trigger = None
    if "[SHOW_SLIDESHOW" in raw_response:
        visual_trigger = "slideshow"
    elif "[SHOW_SYLLABUS" in raw_response:
        visual_trigger = "syllabus"
    elif "[SHOW_VIDEO" in raw_response:
        visual_trigger = "video"
    elif "[SHOW_OFFER" in raw_response:
        visual_trigger = "offer"

    cleaned_response = raw_response \
        .replace("[SHOW_SLIDESHOW]", "") \
        .replace("[SHOW_SYLLABUS]", "") \
        .replace("[SHOW_VIDEO]", "") \
        .strip()

    print("🔍 Raw AI:\n", raw_response)
    print("📦 Trigger:", visual_trigger)

    return {
        "response": cleaned_response,
        "trigger": visual_trigger
    }

# 📽 Visual match
@app.post("/api/media-match")
async def media_match(request: Request):
    body = await request.json()
    raw_type = body.get("type")
    tag = body.get("tag")
    media_type = "image" if raw_type.lower() == "slideshow" else raw_type.lower()
    query = f"{media_type} for {tag} course"
    match_count = 5 if media_type == "image" else 1

    embedding = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query
    ).data[0].embedding

    result = supabase.rpc("match_ai_media_assets", {
        "query_embedding": embedding,
        "match_count": match_count,
        "media_type_input": media_type,
        "tag_input": tag
    }).execute()

    return JSONResponse(content=result.data or [])

# 📅 Upcoming classes
@app.get("/api/upcoming-classes")
async def get_upcoming_classes():
    today = datetime.date.today().isoformat()
    result = supabase.table("upcoming_classes") \
                     .select("*") \
                     .gte("start_date", today) \
                     .order("start_date") \
                     .execute()
    return result.data

# 🖱 Click Tracking
@app.post("/api/session-clicks")
async def track_clicks(request: Request):
    try:
        data = await request.json()
        session_id = data.get("session_id")
        clicks = data.get("clicks", [])

        if not session_id or not clicks:
            return JSONResponse(content={"error": "Missing session or clicks"}, status_code=400)

        # ✅ Ensure session exists
        supabase.table("sessions").upsert({
            "session_id": session_id,
            "last_active": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }, on_conflict="session_id").execute()

        # ✅ Log clicks
        for click in clicks:
            supabase.table("conversation_history").insert({
                "session_id": session_id,
                "sender": "user",
                "message": f"[CLICK] {click.get('label')}",
                "session_metadata": { "click_meta": click }
            }).execute()

        return { "status": "ok", "clicks_logged": len(clicks) }
    except Exception as e:
        print("🔥 session-clicks error:", e)
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500)


# 🧭 Mouse Heatmap
@app.post("/api/session-move")
async def track_mouse_move(request: Request):
    try:
        data = await request.json()
        session_id = data.get("session_id")
        moves = data.get("moves", [])

        if not session_id or not moves:
            return JSONResponse(content={"error": "Missing session or moves"}, status_code=400)

        # ✅ Ensure session exists
        supabase.table("sessions").upsert({
            "session_id": session_id,
            "last_active": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }, on_conflict="session_id").execute()

        # ✅ Save mousemove data
        supabase.table("conversation_history").insert({
            "session_id": session_id,
            "sender": "user",
            "message": "[MOUSEMOVE]",
            "session_metadata": { "heatmap": moves }
        }).execute()

        return { "status": "ok", "points_logged": len(moves) }
    except Exception as e:
        print("🔥 session-move error:", e)
        return JSONResponse(content={"error": "Internal Server Error"}, status_code=500)

