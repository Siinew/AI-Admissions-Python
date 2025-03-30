import os
import time
from supabase import create_client, Client
from dotenv import load_dotenv
import openai
from tqdm import tqdm

# Load environment
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

print("🔐 Supabase URL:", SUPABASE_URL)
print("🔐 OpenAI Key Present:", bool(OPENAI_API_KEY))

# Set up clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)

# Fetch records missing 1536-dim embeddings
response = supabase.table("ai_admissions_trainingdata") \
    .select("id,text") \
    .filter("embedding_1536", "is", "null") \
    .limit(20) \
    .execute()

rows = response.data
print(f"📦 Found {len(rows)} records to embed")

if not rows:
    print("⚠️ No rows found to process.")
    exit()

# Generate embeddings using new SDK format
for row in tqdm(rows):
    try:
        text = row['text']
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-ada-002",
            input=[text]
        )
        embedding = embedding_response.data[0].embedding

        supabase.table("ai_admissions_trainingdata") \
            .update({"embedding_1536": embedding}) \
            .eq("id", row["id"]) \
            .execute()

        print(f"✅ Updated row ID {row['id']}")
        time.sleep(0.3)  # Optional: Respect rate limits

    except Exception as e:
        print(f"❌ Error on row {row['id']}: {e}")
