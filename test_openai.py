import openai
import os

openai.api_key = os.getenv("OPENAI_API_KEY")  # Or set directly as a string

response = openai.ChatCompletion.create(
    model="gpt-3.5-turbo",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is a Wilderness First Aid certification?"}
    ]
)

print(response.choices[0].message['content'])
