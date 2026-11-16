"use client";

import { useState } from "react";

const input: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.65rem 0.85rem",
  font: "inherit",
};

/** Sign in with a profile's username + password; opens that profile's Resume Tailor. */
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Sign in failed");
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1rem" }}>
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: "22rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "2rem 1.5rem",
          display: "grid",
          gap: "0.9rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <h1 style={{ fontSize: "1.4rem" }}>Resume Tailor</h1>
        </div>
        <label>
          <span style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.3rem" }}>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            style={input}
          />
        </label>
        <label>
          <span style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.3rem" }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={input}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !username || !password}
          style={{
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "0.7rem 1rem",
            fontWeight: 600,
            marginTop: "0.25rem",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error && <p style={{ color: "#f87171", fontSize: "0.9rem" }}>{error}</p>}
      </form>
    </main>
  );
}
