import { cn } from "@/lib/utils";

type AuroraOrbProps = {
  size?: number;
  className?: string;
  /** Si true, ajoute un cœur lumineux animé (mode "thinking"). */
  active?: boolean;
};

/**
 * Sphère Aurora animée — pièce centrale de la home AI.
 * Utilise les keyframes définis dans styles.css (aurora-orb).
 */
export function AuroraOrb({ size = 220, className, active = false }: AuroraOrbProps) {
  return (
    <div
      className={cn("aurora-orb", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {active ? (
        <div
          className="absolute inset-[35%] rounded-full"
          style={{
            background:
              "radial-gradient(circle, oklch(1 0 0 / 0.95), oklch(0.85 0.12 286 / 0.4) 60%, transparent)",
            animation: "aurora-breathe 1.6s ease-in-out infinite",
          }}
        />
      ) : null}
    </div>
  );
}
