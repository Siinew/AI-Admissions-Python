from fastapi import FastAPI, Request
from dotenv import load_dotenv
from supabase import create_client
from fastapi.middleware.cors import CORSMiddleware
import openai
import os

# Load environment variables
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GLOBAL_PROMPT_KEY = os.getenv("GLOBAL_PROMPT_KEY")  # <- New

if not GLOBAL_PROMPT_KEY:
    raise ValueError("❌ Environment variable 'GLOBAL_PROMPT_KEY' is not set.")

# Set up Supabase + OpenAI
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
openai.api_key = OPENAI_API_KEY

# FastAPI setup
app = FastAPI()

# CORS for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lock down in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/query")
async def query(request: Request):
    body = await request.json()
    query_text = body.get("query")
    persona_id = body.get("persona_id", "default")

    # 1. Fetch persona + global system prompt using Supabase RPC
    response = supabase.rpc("get_persona_with_global", {
        "persona_id_input": persona_id,
        "prompt_key": GLOBAL_PROMPT_KEY
    }).execute()

    if not response.data:
        return {"error": f"No data found for persona '{persona_id}' and key '{GLOBAL_PROMPT_KEY}'."}

    result = response.data[0]
    full_system_prompt = f"{result['global_prefix']}\n\n{result['system_prompt']}"

    # 2. Embed the query text
    embedding_response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query_text
    )
    query_embedding = embedding_response.data[0].embedding

    # 3. Run vector match on Supabase
    match_result = supabase.rpc("match_ai_admissions_trainingdata", {
        "query_embedding": query_embedding,
        "match_count": 3
    }).execute()

    if not match_result.data:
        return {"error": "No relevant content found in training data."}

    context_chunks = "\n\n".join([match["text"] for match in match_result.data])

    # 4. Call OpenAI with combined context + persona + brand prompt
    messages = [
        {"role": "system", "content": full_system_prompt},
        {"role": "user", "content": f"Context:\n{context_chunks}\n\nQuestion: {query_text}"}
    ]

    chat_response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages
    )

    return {"response": chat_response.choices[0].message.content}
