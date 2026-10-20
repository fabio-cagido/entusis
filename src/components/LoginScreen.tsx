"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sb = getSupabase()!;

  const google = async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  };

  const magic = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="login">
      <div className="login-card glass">
        <div className="brand-mark brand-mark--lg" />
        <h1>êntusis</h1>
        <p className="muted">Páginas, mapas mentais e agenda em uma única base.</p>
        <button id="login-google" className="btn btn-primary btn-block" onClick={google}>
          Entrar com Google
        </button>
        <div className="divider"><span>ou</span></div>
        {sent ? (
          <p className="muted">Enviamos um link para <strong>{email}</strong>.</p>
        ) : (
          <form onSubmit={magic} className="login-form">
            <input
              id="login-email"
              className="input"
              type="email"
              required
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button id="login-magic" className="btn btn-block">Receber link mágico</button>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
