import Link from "next/link";
import { cookies } from "next/headers";
import { AccessGate } from "@/components/AccessGate";
import { ACCESS_COOKIE, gateEnabled, hasAccessCookie } from "@/lib/access-gate";

export default async function Home() {
  const cookieStore = await cookies();
  const unlocked =
    !gateEnabled() || hasAccessCookie(cookieStore.get(ACCESS_COOKIE)?.value);
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-6">
      <div className="relative w-full max-w-64 mb-8 md:mb-10" aria-hidden>
        {/* Light mode: black dots on white */}
        <img
          src="/light_mode_leopard.png"
          alt=""
          width={1376}
          height={768}
          className="block w-full h-auto dark:hidden"
          decoding="async"
        />
        {/* Dark mode: white dots on black */}
        <img
          src="/dark_mode_leopard.png"
          alt=""
          width={1376}
          height={768}
          className="hidden w-full h-auto dark:block"
          decoding="async"
        />
      </div>
      <h1 className="font-mono text-2xl md:text-4xl tracking-[0.35em]">
        ACTION LEOPARD
      </h1>
      <p className="mt-4 max-w-md text-center text-sm text-muted">
        Spatial control for generated action. Translate real locations into
        malleable scenes, direct with precision, generate video that obeys.
      </p>
      {unlocked ? (
        <Link
          href="/login"
          className="mt-10 border border-foreground px-8 py-3 font-mono text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
        >
          Enter
        </Link>
      ) : (
        <AccessGate />
      )}
    </main>
  );
}
