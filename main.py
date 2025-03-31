from fastapi import FastAPI, Request
from dotenv import load_dotenv
from supabase import create_client
from fastapi.middleware.cors import CORSMiddleware
import openai
import os


# Load .env variables
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Set up Supabase + OpenAI
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
openai.api_key = OPENAI_API_KEY

app = FastAPI()

# Allow cross-origin requests from any origin (for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # <-- You can lock this down later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/query")
async def query(request: Request):
    body = await request.json()
    query_text = body.get("query")
    persona_id = body.get("persona_id", "default")

    # 1. Fetch global HMA system prefix
    global_prefix_response = supabase.table("ai_system_settings").select("value").eq("key", "global_system_prefix").single().execute()
    global_prefix = global_prefix_response.data.get("value", "") if global_prefix_response.data else ""

  # 2. Fetch persona + global prefix using Supabase RPC
    response = supabase.rpc("get_persona_with_global", {
        "persona_id_input": persona_id
    }).execute()

    if not response.data or len(response.data) == 0:
        return {"error": f"Persona '{persona_id}' not found or global prefix missing."}

    combined = response.data[0]

    # Compose final system prompt with global brand prefix + persona behavior
    full_system_prompt = f"{combined['global_prefix']}\n\n{combined['system_prompt']}"

    # 3. Embed query
    embedding_response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query_text
    )
    query_embedding = embedding_response.data[0].embedding

    # 4. Query top 3 similar chunks using Supabase RPC
    match_result = supabase.rpc("match_ai_admissions_trainingdata", {
        "query_embedding": query_embedding,
        "match_count": 3
    }).execute()

    if not match_result.data:
        return {"error": "No similar content found."}

    context_chunks = "\n\n".join([match["text"] for match in match_result.data])

    # 5. Build final messages for OpenAI
    messages = [
        {"role": "system", "content": full_system_prompt},
        {"role": "user", "content": f"Context:\n{context_chunks}\n\nQuestion: {query_text}"}
    ]

    # 6. Run chat completion
    chat_response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages
    )

    return {"response": chat_response.choices[0].message.content}