"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { SupabaseRepository } from "@/lib/repository/supabase";
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
      const repo = new SupabaseRepository(sb, userId);
      await init(repo);
      if (!cancelled) {
        unsub = repo.subscribe(applyRemote);
      }
    };

    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) void start(data.session.user.id);
      else setNeedsLogin(true);
    });

    const { data: listener } = sb.auth.onAuthStateChange((evt, session) => {
      if (cancelled) return;
      if (evt === "SIGNED_IN" && session && !started) {
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
