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

    # 1. Fetch persona info
    persona = supabase.table("ai_personas").select("*").eq("persona_id", persona_id).single().execute().data
    if not persona:
        return {"error": f"Persona '{persona_id}' not found."}
    system_prompt = persona["system_prompt"]

    # 2. Embed query
    embedding_response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query_text
    )
    query_embedding = embedding_response.data[0].embedding

    # 3. Run match on Supabase using RPC
    match_result = supabase.rpc("match_ai_admissions_trainingdata", {
        "query_embedding": query_embedding,
        "match_count": 3
    }).execute()
    
    if not match_result.data:
        return {"error": "No similar content found."}

    context_chunks = "\n\n".join([match["text"] for match in match_result.data])

    # 4. Call OpenAI with context
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Context:\n{context_chunks}\n\nQuestion: {query_text}"}
    ]

    chat_response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages
    )

    return {"response": chat_response.choices[0].message.content}
