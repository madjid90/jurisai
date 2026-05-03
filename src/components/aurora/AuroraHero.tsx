import { cn } from "@/lib/utils";

/** Container "page hero" avec mesh background centré.  */
export function AuroraHero({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center overflow-hidden px-4",
        className,
      )}
    >
      {/* Mesh ambient background */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 mesh-bg opacity-90"
        aria-hidden
      />
      {/* Soft top fade to background */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-background to-transparent"
        aria-hidden
      />
      {children}
    </div>
  );
}
