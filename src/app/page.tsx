import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <h1 className="font-mono text-2xl md:text-4xl tracking-[0.35em]">
        ACTION LEOPARD
      </h1>
      <p className="mt-4 max-w-md text-center text-sm text-muted">
        Spatial control for generated action. Translate real locations into
        malleable scenes, direct with precision, generate video that obeys.
      </p>
      <Link
        href="/login"
        className="mt-10 border border-foreground px-8 py-3 font-mono text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
      >
        Enter
      </Link>
    </main>
  );
}
