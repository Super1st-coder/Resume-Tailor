# Resume Tailor

Resume Tailor rewrites a candidate's base resume to fit a job description (using the OpenAI API) and saves it
as a **PDF**, together with the job description as a **.txt** file.

- Several candidates (**profiles**) share one server and one port.
- Each person signs in with their own username and password and sees **only their own profile**.
- An **admin page** counts applications per profile (daily / weekly), adds profiles from a resume PDF, and
  manages logins.

---

## 1. Install on a new Windows VPS

**You need:** a Windows VPS (Windows Server 2019 or newer) with internet access and administrator rights.

1. Copy `ResumeTailor.rar` to the VPS and extract it, e.g. to `C:\ResumeTailor`.
2. Double-click **`run.bat`** and click **Yes** when Windows asks for administrator rights.
3. The **first run takes about 5 minutes**. `run.bat` automatically:
   - installs **Node.js** if it is missing,
   - installs **LibreOffice** if it is missing (needed to create PDFs),
   - opens **TCP port 8000** in the Windows Firewall,
   - installs the packages and builds the app.

   Later runs start in a few seconds.
4. When the window shows `Ready`, open in a browser:

| Address | What it is |
|---|---|
| `http://<VPS-IP>:8000/` | Sign-in page for candidates |
| `http://<VPS-IP>:8000/admin` | Admin page |

**Keep the `run.bat` window open.** Closing it stops the server. To start again, double-click `run.bat`.

**Cloud firewall:** if the VPS is on AWS, Azure, Google Cloud, etc., also allow **TCP 8000** in the provider's
firewall / security group. Otherwise other computers can't reach the site.

---

## 2. Using Resume Tailor (candidates)

1. Open `http://<VPS-IP>:8000/` and sign in with your username and password. At the top you see how many
   resumes you generated **today** and **yesterday**.
2. Enter the **company name**, **job role** and paste the **job description**, or paste the **job link** and click
   **Fill**: the app reads the posting and fills in all three (check them before generating).
   - Works best with LinkedIn, Workday, Greenhouse, Lever, Ashby and most company career pages.
   - If a site refuses the normal read (e.g. Meta), the server opens the link in a hidden Chrome / Edge and reads
     it from there. This takes 10-20 seconds.
   - A few sites block even that (e.g. Cloudsmith, Indeed). Then click **Open ↗**, press
     **Ctrl+A** and **Ctrl+C** on the job page, paste it into **Job description** and click **Fill** again. The AI
     picks out the company, role and description from the pasted page.
3. Choose a **resume style** and click **Generate & save PDF**.
4. The browser downloads two files:
   - `<Company>_<Role> - <Name>.pdf` - the tailored resume
   - `<Company>_<Role> - <Name> - JD.txt` - the job description
5. **Application questions** (right side): paste questions from the job application form and get short answers
   based on the generated resume. Click **New Resume** to start over.
6. Click **Log out** (top right) to sign out. Sessions otherwise last 30 days.

Each generated resume counts as one application on the admin page.

**Bullet rules** (work experience, in order):

| Role | Bullets | One-line | Two-line |
|---|---|---|---|
| 1st (most recent) | more than 9 (10-12) | 60% | 40% |
| 2nd | more than 6 (7-9) | 40% | 60% |
| 3rd | more than 6 (7-9) | 30% | 70% |

While the AI writes the resume, the app checks each of these three roles as soon as it is complete. If a role doesn't
follow the rule, its bullets are rewritten with a short extra AI request that runs alongside the rest of the
generation, so it usually adds no waiting time (it isn't counted as an extra application). The logic is in
`lib/bullet-rules.ts`.

**Project links:** if the candidate's base resume has a Projects section with links (or project names that are web
addresses, e.g. `### Brivano.io – Real Estate Intelligence Platform`), each generated resume gets a short
**Projects** section with one clickable link per project, without bullets. To add or change a project link, edit the
base resume on the admin page (**Manage → Edit the base resume**), e.g. `### [My App](https://myapp.com) – What it is`.

**Company links:** if a job in the base resume has a website on its own line under the company (e.g. `https://riftn.com/`
under `**Riftn** | London, UK`), the same job in each generated resume shows that link at the end of the job title
line, e.g. *Lead Software Engineer | Jan 2021 - Present | riftn.com* (clickable). Jobs without a link are unchanged.

---

## 3. Admin page

Open `http://<VPS-IP>:8000/admin` and enter an admin password. There are two admin levels:

| Level | Password in `.env` | Can do |
|---|---|---|
| **Super admin** | `SUPERADMIN_PASSWORD` | Everything below: counts, history, CSV, import, add/edit/archive profiles, set logins |
| **Admin** (general) | `ADMIN_PASSWORD` | Only the summary tiles (today, yesterday, this week, last week, all time) and the bar chart |

General admins don't receive company names, roles, file names or IPs.

### Application counts
- Totals for **today, yesterday, this week, last week and all time**.
- Tables **every day** (last 14 days) and **every week** (Mon-Sun, last 8 weeks).
- **Bar chart** with a **Daily / Weekly / Monthly** switch (last 14 days, 8 weeks, 12 months). Each bar is split
  by profile; hover a bar to see each profile's count. Click a profile in the legend to hide or show it.
- Full list of applications with search, profile filter and **Export CSV**.
- The history is **kept forever** and can't be deleted from the page.
- **Import past resumes:** add old resume PDFs that were made before counting existed. Company, role and date
  are taken from the file names; files already in the history are skipped.

### Add a new profile
1. In **Profiles**, click **+ Add profile** and choose the candidate's resume **PDF**.
2. Click **Analyze resume**. The AI converts it to the app's resume format (a few seconds).
3. Check the result and correct anything if needed.
4. Enter a **username** and **password** for the candidate and click **Create profile**.

The candidate can sign in right away. No restart is needed.
If a PDF can't be read (e.g. a scanned image), paste the resume text instead.

### Manage a profile
Click **Manage** next to a profile to:
- **Edit the base resume** (used from the next generation on).
- **Replace from PDF:** load an updated resume, check it, then **Save resume**.
- **Change the login.** This signs out anyone using the old password. Usernames must be unique.
- **Archive** the profile: the candidate can't sign in anymore, but the resume, login and history are kept.
  **Restore** brings it back.

---

## 4. Settings (`.env`)

The `.env` file in the project folder holds the settings. Restart (close and reopen `run.bat`) after changing it.

| Setting | Meaning |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key. Several keys can be separated by commas; one is picked at random per request. |
| `OPENAI_MODEL` | Optional. AI model, default `gpt-4o-mini`. |
| `SUPERADMIN_PASSWORD` | Super admin password (full access to the admin page). |
| `ADMIN_PASSWORD` | General admin password (view counts and history only). |
| `SESSION_SECRET` | Signs the sign-in cookies. Changing it signs everyone out. |
| `ALLOWED_IPS` | Optional. Comma-separated IPs; only these may use the site. |
| `CHROME_PATH` | Optional. Browser used by **Fill** for blocked sites. Default: Chrome if installed, otherwise Edge (always on Windows Server). |

Port and displayed address are set at the top of **`run.bat`**:
- `PORT` - default `8000`.
- `PUBLIC_HOST` - the VPS's public IP. Only changes the address printed in the window; set it if the window shows
  a private IP (e.g. `10.x.x.x`).

> **Keep `.env` private.** It contains the OpenAI key and the admin password.

---

## 5. Data and backups

Everything is stored as plain files in the project folder:

| Path | Contents |
|---|---|
| `resumes\<id>.md` | Base resume of each active profile |
| `resumes\_archived\` | Archived profiles |
| `data\applications.jsonl` | Application history (one line per application, add-only) |
| `data\profile-auth.json` | Profile logins (passwords are stored hashed, not readable) |

**Back up `data\` and `resumes\` regularly**, or use **Export CSV** on the admin page. These folders are the
whole database.

**Moving to another server:** stop the old server (close its `run.bat` window), copy the whole project folder (or
at least `.env`, `data\` and `resumes\`) to the new server, then run `run.bat` there. Don't run both servers at the
same time, or the application history will split between them.

Generated resumes are **not** stored on the server. They are converted to PDF in a temporary folder that is deleted
right away, and saved only on the candidate's own PC.

---

## 6. Troubleshooting

| Problem | What to do |
|---|---|
| Other computers can't open the site | Check the `run.bat` window shows `Ready`. Allow TCP 8000 in the cloud provider's firewall. |
| "PDF conversion failed" | LibreOffice is missing: install it from libreoffice.org, or run `run.bat` again. |
| "PDF conversion failed: Failed to fetch" | The connection dropped during conversion (network, VPN, antivirus). Try again or use another network. |
| "Wrong username or password" | Check the login on the admin page (**Manage**); set a new password if needed. |
| "Too many failed attempts" | 10 wrong passwords from one IP block sign-in for 15 minutes. Wait and try again. |
| Changes to the code don't appear | Delete the `.next` folder and run `run.bat` again (it rebuilds). |
| Forgot an admin password | Open `.env`, set a new `SUPERADMIN_PASSWORD` / `ADMIN_PASSWORD`, then restart `run.bat`. |
| **Fill** says "This site doesn't allow automatic reading" | Click **Open ↗**, copy the whole job page (Ctrl+A, Ctrl+C), paste it into Job description, click **Fill** again. |
| "Only the super admin can do this" | You signed in with the general admin password; use the super admin password. |

---

## 7. For developers

- **Stack:** Next.js 14 (App Router), OpenAI API, `docx` (resume DOCX built in the browser), LibreOffice or MS Word
  (DOCX → PDF on the server), `unpdf` (reading uploaded PDFs).
- **Commands:** `npm run profiles` (build + start), `npm run start:all` (start an existing build),
  `npm run dev` (development mode).
- **Sign-in:** `middleware.ts` checks the signed `rt_session` cookie; `lib/session.ts` resolves the profile for
  API routes.
- **Main files:** `app/page.tsx` (Resume Tailor UI), `app/admin/` (admin page), `app/api/` (server routes),
  `lib/` (profiles, logins, history, PDF conversion), `scripts/start-all.js` (launcher used by `run.bat`).
