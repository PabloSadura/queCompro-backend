/*
How to use this backend (local development)


1. Create a project folder and paste files accordingly.
2. Copy .env.example to .env and fill values (Google API keys, path to firebase admin SDK JSON file).
3. Install dependencies: npm install
4. Start server: npm run dev


Notes:
- This project does NOT use Vite. It's a pure Node.js backend.
- Gemini integration requires a valid Google Generative AI API key/OAuth token.
- Google Custom Search requires an API key + Custom Search Engine (CX).
- Firebase Admin requires a service account JSON; set FIREBASE_ADMIN_SDK_PATH to its path.


Security & Production:
- Never commit serviceAccountKey.json or API keys to source control.
- Use environment variables (or secret manager) in production.
*/