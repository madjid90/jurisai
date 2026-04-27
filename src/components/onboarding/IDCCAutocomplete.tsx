import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { searchIDCC } from "@/server/tenant.functions";
import { cn } from "@/lib/utils";

interface IDCCAutocompleteProps {
  value: string;
  onChange: (idcc: string, title?: string) => void;
  placeholder?: string;
  label?: string;
}

/**
 * Combobox connected to public.conventions_collectives.
 * User can type either a free IDCC code or pick from suggestions.
 */
export function IDCCAutocomplete({
  value,
  onChange,
  placeholder = "ex. 1486, Syntec, métallurgie…",
  label,
}: IDCCAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(query);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Close on click outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["idcc-search", debounced],
    queryFn: () => searchIDCC({ data: { q: debounced } }),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <div ref={wrapRef} className="relative">
      {label && (
        <label className="mb-1.5 block text-[12.5px] font-medium text-foreground">{label}</label>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-[13.5px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && data && data.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-[var(--shadow-elevated)]">
          {data.map((cc) => (
            <button
              key={cc.idcc}
              type="button"
              onClick={() => {
                setQuery(cc.idcc);
                onChange(cc.idcc, cc.title);
                setOpen(false);
              }}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-secondary",
                value === cc.idcc && "bg-accent-soft text-accent-soft-foreground",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] font-semibold">{cc.idcc}</span>
                {cc.brochure && (
                  <span className="text-[10px] text-muted-foreground">JO {cc.brochure}</span>
                )}
              </div>
              <span className="line-clamp-1 text-[12.5px] text-foreground/80">
                {cc.short_title ?? cc.title}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && data && data.length === 0 && !isFetching && debounced.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-popover p-3 text-center text-[12px] text-muted-foreground shadow-[var(--shadow-elevated)]">
          Aucune convention trouvée. Vous pouvez saisir un code libre.
        </div>
      )}
    </div>
  );
}
