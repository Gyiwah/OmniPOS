import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Store } from "lucide-react";

import { ApiError } from "@/api/client";
import { bootstrapStore } from "@/sync/engine";
import { useSession } from "@/state/session";

export function LoginPage() {
  const user = useSession((s) => s.user);
  const login = useSession((s) => s.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      setStage("Signing in…");
      await login(email, password);

      const storeId = useSession.getState().storeId;
      if (storeId) {
        // First load pulls the catalogue down so the till works offline from
        // here on. Failing this is not fatal — the sync engine will retry.
        setStage("Downloading catalogue for offline use…");
        try {
          await bootstrapStore(storeId);
        } catch {
          setStage(null);
        }
      }

      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.isUnreachable) {
        setError("Cannot reach the server. Check the connection and try again.");
      } else if (err instanceof ApiError && err.isValidation) {
        setError("Those credentials do not match our records.");
      } else {
        setError(err instanceof Error ? err.message : "Sign in failed.");
      }
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <h1><Store size={22} className="brand-mark" aria-hidden="true" /> OmniPOS</h1>
        <p className="muted">Sign in to your till</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {stage && <p className="muted" role="status">{stage}</p>}

        <button type="submit" disabled={busy} className="pay-button">
          {busy ? "Please wait…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
