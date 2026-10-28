import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const errorParam =
    requestUrl.searchParams.get("error_description") ||
    requestUrl.searchParams.get("error");
  const nextParam = requestUrl.searchParams.get("next") ?? "/today";
  const nextPath = nextParam.startsWith("/") ? nextParam : "/today";

  // Determinar origin confiável (suporta proxy/Vercel x-forwarded-host e localhost)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const isLocalEnv = process.env.NODE_ENV === "development";
  const origin =
    !isLocalEnv && forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : requestUrl.origin;

  if (errorParam) {
    const errUrl = new URL("/today", origin);
    errUrl.searchParams.set("auth_error", errorParam);
    return NextResponse.redirect(errUrl);
  }

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const cookieStore = await cookies();
      const pendingCookies: {
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }[] = [];

      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              pendingCookies.push({ name, value, options });
              try {
                cookieStore.set(name, value, options);
              } catch {
                // Aplicado também diretamente no NextResponse abaixo
              }
            });
          },
        },
      });

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data.session) {
        const targetUrl = new URL(nextPath, origin);
        targetUrl.searchParams.set("gcal", "connected");
        const response = NextResponse.redirect(targetUrl);

        // Garantir que todos os cookies da sessão sejam gravados no cabeçalho Set-Cookie do redirect
        for (const { name, value, options } of pendingCookies) {
          response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
        }

        return response;
      }

      if (error) {
        console.error("[auth/callback] Falha em exchangeCodeForSession:", error.message);
        const errUrl = new URL("/today", origin);
        errUrl.searchParams.set("auth_error", error.message);
        return NextResponse.redirect(errUrl);
      }
    }
  }

  return NextResponse.redirect(new URL(nextPath, origin));
}

