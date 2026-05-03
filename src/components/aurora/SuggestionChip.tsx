import { cn } from "@/lib/utils";

type SuggestionChipProps = {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
};

/**
 * Chip suggestion — utilisée sous le HeroPromptInput.
 * Style verre dépoli + lift au hover (cf. .glass-pill dans styles.css).
 */
export function SuggestionChip({ icon, label, onClick, className }: SuggestionChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("glass-pill", className)}
    >
      {icon ? <span className="text-accent">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}
