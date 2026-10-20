"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { Lock, Mail, Sparkles, UserPlus, LogIn } from "lucide-react";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sb = getSupabase()!;

  const handleGoogle = async () => {
    setError(null);
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/today?gcal=connected`,
        scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) setError(error.message);
  };

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) {
          // Logged in immediately
        } else {
          setInfo("Conta criada com sucesso! Se a confirmação de e-mail estiver ativa no Supabase, verifique sua caixa de entrada.");
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid login credentials")) {
        setError("E-mail ou senha incorretos. Se ainda não tem senha, crie sua conta ou use o Link Mágico.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setInfo(`Enviamos um link mágico de acesso para ${email}. Clique nele para entrar.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card glass">
        <div className="brand-mark brand-mark--lg" />
        <h1>êntusis</h1>
        <p className="muted">Páginas, mapas mentais e agenda em uma única base.</p>

        <button id="login-google" className="btn btn-primary btn-block" onClick={handleGoogle}>
          Entrar com Google
        </button>

        <div className="divider"><span>ou com e-mail</span></div>

        {mode === "password" ? (
          <form onSubmit={handlePasswordAuth} className="login-form">
            <div className="input-group">
              <input
                id="login-email"
                className="input"
                type="email"
                required
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="input-group">
              <input
                id="login-password"
                className="input"
                type="password"
                required
                placeholder="Sua senha (mínimo 6 caracteres)"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button id="login-submit" className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? "Aguarde…" : isSignUp ? (
                <><UserPlus size={15} /> Criar conta com senha</>
              ) : (
                <><LogIn size={15} /> Entrar com senha</>
              )}
            </button>

            <div className="login-actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setInfo(null);
                }}
              >
                {isSignUp ? "Já tem conta? Entrar com senha" : "Ainda não tem senha? Cadastrar aqui"}
              </button>

              <button
                type="button"
                className="btn-link muted"
                onClick={() => {
                  setMode("magic");
                  setError(null);
                  setInfo(null);
                }}
              >
                <Sparkles size={13} /> Prefiro receber link mágico por e-mail
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleMagicLink} className="login-form">
            <input
              id="login-email"
              className="input"
              type="email"
              required
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button id="login-magic" className="btn btn-block" type="submit" disabled={loading}>
              {loading ? "Enviando…" : "Receber link mágico"}
            </button>
            <div className="login-actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setMode("password");
                  setError(null);
                  setInfo(null);
                }}
              >
                <Lock size={13} /> Entrar usando senha
              </button>
            </div>
          </form>
        )}

        {info && <p className="info-text">{info}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
