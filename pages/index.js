import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>SnapGrid Web</h1>
      <p style={{ marginBottom: 16 }}>
        This is a minimal web version of SnapGrid for testing. Click below to try the game.
      </p>
      <Link href="/play" style={{ color: "#6366f1", textDecoration: "underline" }}>
        Play Now →
      </Link>
      <p style={{ marginTop: 40, color: "#6b7280" }}>
        Note: This is a test build and does not include all features. A full build with
        competitions, store, and leaderboards will be deployed later.
      </p>
    </main>
  );
}
