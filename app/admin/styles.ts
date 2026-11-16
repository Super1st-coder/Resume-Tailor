import type { CSSProperties } from "react";

// Shared styles for the admin page.
export const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.25rem",
  marginBottom: "1.25rem",
};
export const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: "0.8rem",
  whiteSpace: "nowrap",
};
export const td: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};
export const num: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
export const input: CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.5rem 0.75rem",
  font: "inherit",
};
export const button: CSSProperties = {
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "0.5rem 1rem",
  fontWeight: 600,
};
export const ghost: CSSProperties = {
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.4rem 0.8rem",
};
