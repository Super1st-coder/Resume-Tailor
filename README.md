# Resume Tailor

Next.js app that takes user text, calls the OpenAI API, and lets the client download the response as a DOCX file.

## Flow

1. **Client**: User enters text in the UI and submits.
2. **Server**: Next.js API route receives the input, calls OpenAI (`gpt-4o-mini` by default, override with `OPENAI_MODEL`) with your API key, and streams the response back.
3. **Client**: Receives the JSON and generates a DOCX in the browser using the `docx` package, then triggers a download.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure OpenAI API key**

   Copy the example env file and set your key:

   ```bash
   copy .env.local.example .env.local
   ```

   Edit `.env.local` and set:

   ```
   OPENAI_API_KEY=your_openai_api_key
   ```

   Get an API key at [OpenAI](https://platform.openai.com/api-keys).

   **Multiple API keys (round-robin):** Use a single key, or comma-separated list: `OPENAI_API_KEY=key1,key2,key3`. Each request picks one at random.

   **IP whitelist:** Set `ALLOWED_IPS=1.2.3.4,192.168.1.1` (comma-separated). Only these IPs can access the app; others are redirected to `/blocked`. Leave unset to allow all IPs.

   **Log viewer:** Set `LOG_VIEWER_SECRET` to a secret string. Then open `/logs?key=<that_secret>` to see generation logs (per request: line #, time in EST, IP, generated filename) with pagination and filters. **Local:** add `LOG_VIEWER_SECRET=your_secret` to `.env.local`, run `npm run dev`, and visit `http://localhost:3000/logs?key=your_secret`. On Vercel use the same URL with your app host.

   **Persistent logs on Vercel:** By default logs are in-memory and are cleared on cold start. Add **Vercel KV** (or Upstash Redis) in your Vercel project’s Storage; Vercel will set `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The app uses these (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` from Upstash Console) to store logs in Redis (up to 5000 entries) so they persist across restarts.

3. **Run the app**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000), enter a prompt, and click **Generate & download DOCX**. The app will call the LLM and download a `.docx` file with the response (and reasoning details if present).

## Tech

- **Next.js 14** (App Router)
- **OpenAI** via the official `openai` client
- **docx** for client-side DOCX generation and download
