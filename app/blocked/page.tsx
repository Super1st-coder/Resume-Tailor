export default function BlockedPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        The website is still under development.
      </h1>
      <p style={{ color: "var(--muted)", textAlign: "center" }}>
        Once the website is ready, you will be able to access it. Thank you for your patience. Contact the administrator if you believe this is an error.
      </p>
    </main>
  );
}
