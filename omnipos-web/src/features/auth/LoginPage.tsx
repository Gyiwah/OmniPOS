import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { db } from "@/db/schema";
import { ApiError } from "@/api/client";
import { ensureCatalogue } from "@/sync/engine";
import { useSession } from "@/state/session";

const LAST_EMAIL_KEY = "omnipos.web.last-email";

export function LoginPage() {
  const user = useSession((s) => s.user);
  const login = useSession((s) => s.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch {
      // Private mode, or a till that has storage disabled.
    }
  }, []);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      setStage("Signing in…");
      await login(email, password);

      try {
        localStorage.setItem(LAST_EMAIL_KEY, email.trim());
      } catch {
        // Same as above: remembering the email is a convenience, not a requirement.
      }

      const storeId = useSession.getState().storeId;
      if (storeId) {
        // Navigate immediately. The till shows the same download if the local
        // catalogue is empty, via ensureCatalogue, so this is not abandoned.
        void (async () => {
          try {
            const count = await db.products.where("store_id").equals(storeId).count();
            if (count === 0) {
              await ensureCatalogue(storeId);
            }
          } catch {
            // Background sync will retry
          }
        })();
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
        <div className="auth-brand">
          <img src="/android-chrome-192x192.png" alt="OmniPOS" className="auth-brand-image" />
          <h1>OmniPOS</h1>
        </div>
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
        <div className="password-field">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="icon-button password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {stage && <p className="muted" role="status">{stage}</p>}

        <button type="submit" disabled={busy} className="pay-button">
          {busy ? "Please wait…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
