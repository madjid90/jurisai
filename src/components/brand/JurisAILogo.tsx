export function JurisAILogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="JurisAI logo"
    >
      <defs>
        <linearGradient id="jurisai-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="oklch(0.27 0.09 265)" />
          <stop offset="100%" stopColor="oklch(0.58 0.22 286)" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#jurisai-grad)" />
      {/* Stylized "J" balance/scale mark */}
      <path
        d="M14 11.5h12M20 11.5v13c0 2.2-1.8 4-4 4h-1"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="26" cy="26" r="2.2" fill="white" />
    </svg>
  );
}

export function JurisAIWordmark({ className }: { className?: string }) {
  return (
    <div className={"flex items-center gap-2.5 " + (className ?? "")}>
      <JurisAILogo className="h-8 w-8" />
      <span className="text-[17px] font-semibold tracking-tight text-foreground">
        juris<span className="text-accent">AI</span>
      </span>
    </div>
  );
}
