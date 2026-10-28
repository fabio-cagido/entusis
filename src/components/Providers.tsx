"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { SupabaseRepository } from "@/lib/repository/supabase";
import { setGcalTokens } from "@/lib/google/calendar";
import LoginScreen from "./LoginScreen";

export default function Providers({ children }: { children: React.ReactNode }) {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const applyRemote = useStore((s) => s.applyRemote);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let started = false;
    let cancelled = false;

    const sb = getSupabase();
    if (!isSupabaseConfigured || !sb) {
      void init();
      return;
    }

    const start = async (userId: string) => {
      if (started || cancelled) return;
      started = true;
      setNeedsLogin(false);
      const repo = new SupabaseRepository(sb, userId);
      await init(repo);
      if (!cancelled) {
        unsub = repo.subscribe(applyRemote);
      }
    };

    const bootstrapSession = async () => {
      try {
        // Fallback client-side PKCE: caso o Supabase redirecione diretamente com ?code= para a raiz ou /today
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const code = url.searchParams.get("code");
          if (code) {
            const { data: exchData, error: exchErr } = await sb.auth.exchangeCodeForSession(code);
            url.searchParams.delete("code");
            window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
            if (!exchErr && exchData.session) {
              if (cancelled) return;
              if (exchData.session.provider_token) {
                setGcalTokens(exchData.session.provider_token, exchData.session.provider_refresh_token);
              }
              void start(exchData.session.user.id);
              return;
            }
          }
        }

        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          if (data.session.provider_token) {
            setGcalTokens(data.session.provider_token, data.session.provider_refresh_token);
          }
          void start(data.session.user.id);
        } else {
          setNeedsLogin(true);
        }
      } catch {
        if (!cancelled) {
          setNeedsLogin(true);
        }
      }
    };

    void bootstrapSession();

    const { data: listener } = sb.auth.onAuthStateChange((evt, session) => {
      if (cancelled) return;
      if (session?.provider_token) {
        setGcalTokens(session.provider_token, session.provider_refresh_token);
      }
      if (
        (evt === "SIGNED_IN" || evt === "INITIAL_SESSION" || evt === "TOKEN_REFRESHED") &&
        session &&
        !started
      ) {
        setNeedsLogin(false);
        void start(session.user.id);
      }
      if (evt === "SIGNED_OUT") {
        started = false;
        window.location.reload();
      }
    });

    return () => {
      cancelled = true;
      unsub?.();
      listener.subscription.unsubscribe();
    };
  }, [init, applyRemote]);

  if (needsLogin) return <LoginScreen />;
  if (!ready)
    return (
      <div className="splash">
        <div className="brand-mark brand-mark--lg" />
        <p>Carregando seus nós…</p>
      </div>
    );
  return <>{children}</>;
}
