import { useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/ustrack-logo.png";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const u = mode === "login" ? await login(email, password) : await signup(email, password, displayName);
      navigate(u.onboarding_completed_at ? "/" : "/onboarding");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      try {
        const parsed = JSON.parse(message) as { detail?: string };
        setError(parsed.detail ?? message);
      } catch {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-bg px-4">
      <div
        className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-accent-soft opacity-60 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-cat-dual-soft opacity-50 blur-3xl"
        aria-hidden
      />

      <div className="relative flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-line bg-surface-raised p-8 shadow-soft-lg">
        <div className="flex flex-col items-center gap-2.5">
          <img src={logo} alt="USTrack" className="h-auto w-36" />
          <p className="text-[13px] text-muted">
            {mode === "login" ? "Log in to your plan" : "Create your account"}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "signup" ? (
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="text-muted">Name (optional)</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@connect.ust.hk"
              className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-muted">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>

          {error ? <p className="text-[12px] text-accent">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-ink px-3 py-2.5 text-[13px] font-medium text-bg shadow-soft transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-40"
          >
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        <p className="text-center text-[12px] text-muted">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
            className="font-medium text-accent hover:underline"
          >
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </div>
    </main>
  );
}
