import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { getTenantQuota } from "@/server/tenant.functions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Compact quota indicator displayed in the sidebar.
 * Color shifts to warning (>=80%) and destructive (>=100%).
 */
export function QuotaBadge() {
  const { user, loading } = useAuth();
  const { data, error } = useQuery({
    queryKey: ["tenant-quota"],
    queryFn: () => getTenantQuota(),
    enabled: !!user && !loading,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  const errorMessage = error instanceof Error ? error.message : "";
  if (/AUTH_SERVICE_UNAVAILABLE/i.test(errorMessage)) return null;

  if (!user || loading || !data) return null;

  const tone =
    data.pct >= 100
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : data.pct >= 80
        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
        : "border-border bg-card text-foreground";

  return (
    <Link
      to="/settings"
      className={cn(
        "mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] transition hover:opacity-90",
        tone,
      )}
      title={`Plan ${data.plan} — ${data.used}/${data.quota} questions ce mois`}
    >
      <Zap className="h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1 font-medium">
          <span className="truncate capitalize">{data.plan}</span>
          <span className="font-mono text-[11px] tabular-nums">
            {data.used}/{data.quota}
          </span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              data.pct >= 100
                ? "bg-destructive"
                : data.pct >= 80
                  ? "bg-yellow-500"
                  : "bg-primary",
            )}
            style={{ width: `${Math.min(100, data.pct)}%` }}
          />
        </div>
      </div>
    </Link>
  );
}
