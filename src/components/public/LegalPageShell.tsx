import type { ReactNode } from "react";
import { PublicHeader, PublicFooter } from "./PublicLayout";

export function LegalPageShell({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <div className="mesh-bg min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10 border-b border-border/60 pb-8">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-accent">
            JurisAI
          </p>
          <h1 className="text-[32px] font-bold tracking-tight text-foreground sm:text-[40px]">
            {title}
          </h1>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Dernière mise à jour : {updatedAt}
          </p>
        </header>
        <article className="prose-legal space-y-6 text-[14.5px] leading-relaxed text-foreground/85">
          {children}
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="space-y-3 text-[14px] text-foreground/80">{children}</div>
    </section>
  );
}
