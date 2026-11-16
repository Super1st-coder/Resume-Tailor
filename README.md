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

## Run it (one port for every profile)

```bash
npm run profiles      # build + start
npm run start:all     # start using the existing build
```

**On Windows just double-click `run.bat`**: it installs Node.js and LibreOffice if missing, opens the
firewall port, installs packages, builds once and starts. One server runs on port 8000 (`PORT` to change):

- `http://<server-ip>:8000/` - sign in. The **username decides the profile**: each person sees only their
  own profile's Resume Tailor and base resume.
- `http://<server-ip>:8000/admin` - admin page (`ADMIN_PASSWORD` in `.env`): application counts per
  profile, add a profile from a resume PDF, edit resumes, set logins, archive/restore profiles.

Profiles are `resumes/<id>.md` (archived ones in `resumes/_archived/`). Adding or editing one needs no restart.
Logins are in `data/profile-auth.json` (hashed passwords), application history in `data/applications.jsonl`
(add-only; back it up). `SESSION_SECRET` in `.env` signs the login cookies.

**On a VPS:** the server listens on all interfaces; set `PUBLIC_HOST=<public-ip>` behind NAT. `run.bat` opens the port in Windows Firewall; a cloud firewall (AWS, Azure, ...) must allow it too.

## Where resumes are saved

Nothing is stored on the server. The server converts the DOCX to PDF in a temp folder (MS Word on Windows), deletes it,
and the browser saves the PDF on the user's PC:

- **Chrome/Edge on https:// or localhost:** click **Choose folder** once (e.g. `D:\Resume`); files go to
  `D:\Resume\<Name>\<Company_Role>\` with the JD as a `.txt`.
- **Otherwise (e.g. plain http://IP:6000):** a normal download to the browser's Downloads folder.
