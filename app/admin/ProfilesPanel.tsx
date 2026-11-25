"use client";

import { useRef, useState } from "react";
import { button, card, ghost, input, td, th } from "./styles";

export type AdminProfile = {
  id: string;
  name: string;
  archived?: boolean;
  /** Username of the profile's login, or null when it has none (nobody can sign in). */
  user?: string | null;
  updated?: string | null;
};

type Props = { adminKey: string; profiles: AdminProfile[]; reload: () => Promise<void> | void };

const textarea: React.CSSProperties = {
  ...input,
  width: "100%",
  minHeight: "22rem",
  fontFamily: "Consolas, 'Cascadia Mono', monospace",
  fontSize: "0.85rem",
  lineHeight: 1.45,
  resize: "vertical",
};
const label: React.CSSProperties = { display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.25rem" };
const okColor = "#34d399";
const warnColor = "#fbbf24";
const errColor = "#f87171";

/** Address people sign in at (same server as this admin page). */
function siteUrl(): string {
  return typeof window === "undefined" ? "/" : `${window.location.origin}/`;
}

/** Upload a resume PDF (or pasted text) and get the profile Markdown back. */
async function parseResume(adminKey: string, file: File | null, text: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  else form.append("text", text);
  const res = await fetch("/api/admin/resume/parse", { method: "POST", headers: { "x-admin-key": adminKey }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Conversion failed (${res.status})`);
  return data as { markdown: string; name: string; suggestedId: string };
}

async function api(adminKey: string, url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export default function ProfilesPanel({ adminKey, profiles, reload }: Props) {
  const active = profiles.filter((p) => !p.archived);
  const archived = profiles.filter((p) => p.archived);

  // ---- add profile ----
  const [addOpen, setAddOpen] = useState(false);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addText, setAddText] = useState("");
  const [addMd, setAddMd] = useState("");
  const [addId, setAddId] = useState("");
  const [addUser, setAddUser] = useState("");
  const [addPass, setAddPass] = useState("");
  const [addBusy, setAddBusy] = useState<"" | "parse" | "save">("");
  const [addMsg, setAddMsg] = useState<{ text: string; color?: string } | null>(null);

  // ---- manage one profile ----
  const [selected, setSelected] = useState<string | null>(null);
  const [md, setMd] = useState("");
  const [mdLoaded, setMdLoaded] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; color?: string } | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const replaceInput = useRef<HTMLInputElement>(null);

  const sel = profiles.find((p) => p.id === selected) ?? null;

  async function analyze() {
    setAddBusy("parse");
    setAddMsg({ text: "Reading the resume and formatting it… (up to a minute)" });
    try {
      const r = await parseResume(adminKey, addFile, addText);
      setAddMd(r.markdown);
      setAddId(r.suggestedId);
      setAddMsg({ text: `Check the resume below (name: ${r.name}), fix anything if needed, then create the profile.` });
    } catch (err) {
      setAddMsg({ text: err instanceof Error ? err.message : "Conversion failed", color: errColor });
    } finally {
      setAddBusy("");
    }
  }

  async function createProfile() {
    const id = addId.trim();
    if (!addUser.trim() || addPass.length < 6) {
      setAddMsg({ text: "Set a username and a password (at least 6 characters) so this profile can sign in.", color: errColor });
      return;
    }
    setAddBusy("save");
    try {
      await api(adminKey, "/api/admin/resume", "PUT", { profile: id, markdown: addMd, create: true });
      try {
        await api(adminKey, "/api/admin/profiles", "PUT", { profile: id, username: addUser.trim(), password: addPass });
      } catch (err) {
        // Profile exists now; only the login failed (e.g. username taken). Fix it under Manage.
        setAddMsg({
          text: `Profile created, but the login was not saved: ${err instanceof Error ? err.message : "error"}. Set it under Manage.`,
          color: warnColor,
        });
        setAddMd("");
        await reload();
        return;
      }
      setAddMsg({
        text: `Profile created. Sign in at ${siteUrl()} with username "${addUser.trim()}".`,
        color: okColor,
      });
      setAddFile(null);
      setAddText("");
      setAddMd("");
      setAddUser("");
      setAddPass("");
      await reload();
    } catch (err) {
      setAddMsg({ text: err instanceof Error ? err.message : "Create failed", color: errColor });
    } finally {
      setAddBusy("");
    }
  }

  async function openProfile(id: string) {
    if (selected === id) {
      setSelected(null);
      return;
    }
    setSelected(id);
    setMsg(null);
    setMd("");
    setMdLoaded("");
    setLoginUser("");
    setLoginPass("");
    try {
      const res = await fetch(`/api/admin/resume?profile=${encodeURIComponent(id)}`, {
        headers: { "x-admin-key": adminKey },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load the resume");
      setMd(data.markdown);
      setMdLoaded(data.markdown);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Load failed", color: errColor });
    }
  }

  async function saveResume() {
    if (!sel) return;
    setBusy("save");
    try {
      await api(adminKey, "/api/admin/resume", "PUT", { profile: sel.id, markdown: md, create: false });
      setMdLoaded(md);
      setMsg({ text: "Resume saved. It is used from the next generation on (no restart needed).", color: okColor });
      await reload();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Save failed", color: errColor });
    } finally {
      setBusy("");
    }
  }

  async function replaceFromPdf(file: File | null) {
    if (!file) return;
    setBusy("parse");
    setMsg({ text: "Reading the PDF and formatting it… (up to a minute)" });
    try {
      const r = await parseResume(adminKey, file, "");
      setMd(r.markdown);
      setMsg({ text: "New resume loaded below. Check it, then click Save resume to use it.", color: warnColor });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Conversion failed", color: errColor });
    } finally {
      setBusy("");
      if (replaceInput.current) replaceInput.current.value = "";
    }
  }

  async function saveLogin() {
    if (!sel) return;
    setBusy("login");
    try {
      await api(adminKey, "/api/admin/profiles", "PUT", { profile: sel.id, username: loginUser.trim(), password: loginPass });
      setLoginUser("");
      setLoginPass("");
      setMsg({ text: "Login saved. It works right away.", color: okColor });
      await reload();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Save failed", color: errColor });
    } finally {
      setBusy("");
    }
  }

  async function archive(p: AdminProfile, archive: boolean) {
    if (
      archive &&
      !confirm(
        `Archive ${p.name}? They can no longer sign in. The resume, login and application history are kept, and you can restore it any time.`
      )
    )
      return;
    setBusy("archive");
    try {
      await api(adminKey, "/api/admin/resume/archive", "POST", { profile: p.id, archived: archive });
      setMsg({
        text: archive ? `${p.name} archived.` : `${p.name} restored. They can sign in again.`,
        color: okColor,
      });
      await reload();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed", color: errColor });
    } finally {
      setBusy("");
    }
  }

  async function remove(p: AdminProfile) {
    const typed = prompt(
      `Delete ${p.name} permanently?\n\n` +
        "They can no longer sign in, and the profile and its login are removed. " +
        "Past applications stay in the history and counts.\n\n" +
        `To confirm, type the profile id: ${p.id}`
    );
    if (typed === null) return;
    if (typed.trim() !== p.id) {
      setMsg({ text: "Not deleted: the id you typed doesn't match.", color: errColor });
      return;
    }
    setBusy("delete");
    try {
      await api(adminKey, "/api/admin/resume/delete", "POST", { profile: p.id });
      setSelected(null);
      await reload();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Delete failed", color: errColor });
    } finally {
      setBusy("");
    }
  }

  const status = (p: AdminProfile) =>
    p.archived ? (
      <span style={{ color: "var(--muted)" }}>Archived</span>
    ) : p.user ? (
      <span style={{ color: okColor }}>● Active</span>
    ) : (
      <span style={{ color: warnColor }}>● No login yet</span>
    );

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
        <h2 style={{ fontSize: "1.1rem", flex: 1 }}>Profiles ({active.length})</h2>
        <button style={button} onClick={() => setAddOpen((o) => !o)}>
          {addOpen ? "Close" : "+ Add profile"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
        Everyone signs in at <a href={siteUrl()} target="_blank" rel="noreferrer">{siteUrl().replace(/^https?:\/\//, "")}</a>; the username decides which profile&apos;s Resume Tailor they see. Click a profile to edit its resume, change its login, archive it or delete it.
      </p>

      {/* ---- Add profile ---- */}
      {addOpen && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Add profile from a resume PDF</h3>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
              style={{ ...input, padding: "0.35rem" }}
            />
            <button
              style={button}
              disabled={addBusy !== "" || (!addFile && addText.trim().length < 200)}
              onClick={analyze}
            >
              {addBusy === "parse" ? "Analyzing…" : "Analyze resume"}
            </button>
          </div>
          {!addFile && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.85rem" }}>
                No PDF? Paste the resume text instead
              </summary>
              <textarea
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                placeholder="Paste the full resume text here…"
                style={{ ...textarea, minHeight: "8rem", marginTop: "0.5rem" }}
              />
            </details>
          )}
          {addMsg && <p style={{ marginTop: "0.75rem", color: addMsg.color }}>{addMsg.text}</p>}

          {addMd && (
            <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
              <div>
                <span style={label}>Resume (Markdown; same format as the other profiles)</span>
                <textarea value={addMd} onChange={(e) => setAddMd(e.target.value)} style={textarea} spellCheck={false} />
              </div>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                <label>
                  <span style={label}>Profile id (file name)</span>
                  <input
                    value={addId}
                    onChange={(e) => setAddId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                    style={{ ...input, width: "12rem" }}
                  />
                </label>
                <label>
                  <span style={label}>Login username</span>
                  <input value={addUser} onChange={(e) => setAddUser(e.target.value)} autoComplete="off" style={{ ...input, width: "11rem" }} />
                </label>
                <label>
                  <span style={label}>Login password</span>
                  <input
                    type="password"
                    value={addPass}
                    onChange={(e) => setAddPass(e.target.value)}
                    autoComplete="new-password"
                    placeholder="min. 6 characters"
                    style={{ ...input, width: "11rem" }}
                  />
                </label>
                <button
                  style={button}
                  disabled={addBusy !== "" || !addId || !addMd.trim() || !addUser.trim() || addPass.length < 6}
                  onClick={createProfile}
                >
                  {addBusy === "save" ? "Creating…" : "Create profile"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Profile list ---- */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Profile</th>
              <th style={th}>Status</th>
              <th style={th}>Login</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {[...active, ...archived].map((p) => {
              const open = selected === p.id;
              return (
                <tr key={p.id} style={{ background: open ? "rgba(99,102,241,0.12)" : undefined, opacity: p.archived ? 0.7 : 1 }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {p.name}
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem", fontWeight: 400 }}>{p.id}</div>
                  </td>
                  <td style={td}>{status(p)}</td>
                  <td style={td}>
                    {p.user ? <strong>{p.user}</strong> : <span style={{ color: warnColor }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button style={ghost} onClick={() => openProfile(p.id)}>
                      {open ? "Close" : "Manage"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Manage selected profile ---- */}
      {sel && (
        <div style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: "1rem", marginTop: "1rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <h3 style={{ fontSize: "1rem", flex: 1 }}>
              {sel.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({sel.id})</span>
            </h3>
            {sel.archived ? (
              <button style={button} disabled={busy !== ""} onClick={() => archive(sel, false)}>
                Restore profile
              </button>
            ) : (
              <button style={{ ...ghost, color: errColor }} disabled={busy !== ""} onClick={() => archive(sel, true)}>
                Archive profile
              </button>
            )}
            <button
              style={{ ...button, background: errColor, borderColor: errColor }}
              disabled={busy !== ""}
              onClick={() => remove(sel)}
            >
              {busy === "delete" ? "Deleting…" : "Delete profile"}
            </button>
          </div>
          {msg && <p style={{ color: msg.color }}>{msg.text}</p>}

          {/* Resume */}
          <div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
              <strong style={{ flex: 1 }}>Base resume</strong>
              <input
                ref={replaceInput}
                type="file"
                accept=".pdf,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => replaceFromPdf(e.target.files?.[0] ?? null)}
              />
              <button style={ghost} disabled={busy !== ""} onClick={() => replaceInput.current?.click()}>
                {busy === "parse" ? "Analyzing…" : "Replace from PDF…"}
              </button>
              <button style={button} disabled={busy !== "" || md === mdLoaded || !md.trim()} onClick={saveResume}>
                {busy === "save" ? "Saving…" : "Save resume"}
              </button>
            </div>
            <textarea value={md} onChange={(e) => setMd(e.target.value)} style={textarea} spellCheck={false} />
            {md !== mdLoaded && <p style={{ color: warnColor, fontSize: "0.85rem" }}>Unsaved changes</p>}
          </div>

          {/* Login */}
          <div>
            <strong>Login</strong>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem" }}>
              {sel.user
                ? `Current username: ${sel.user}. Passwords are stored encrypted; set a new one to change it. Changing it signs out anyone using the old login.`
                : "No login yet: set a username and password so this profile can sign in."}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <input
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                placeholder={sel.user ?? "username"}
                autoComplete="off"
                style={{ ...input, width: "12rem" }}
              />
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                placeholder="new password (min. 6)"
                autoComplete="new-password"
                style={{ ...input, width: "12rem" }}
              />
              <button style={button} disabled={busy !== "" || !loginUser.trim() || loginPass.length < 6} onClick={saveLogin}>
                {busy === "login" ? "Saving…" : "Save login"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
