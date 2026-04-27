import { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function MessageFeedback({ messageId, tenantId }: { messageId: string; tenantId: string }) {
  const { user } = useAuth();
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (value: -1 | 1) => {
    if (!user || loading) return;
    setLoading(true);
    const prev = rating;
    setRating(value);
    const { error } = await supabase.from("message_feedback").upsert(
      { message_id: messageId, user_id: user.id, tenant_id: tenantId, rating: value },
      { onConflict: "message_id,user_id" },
    );
    setLoading(false);
    if (error) {
      setRating(prev);
      toast.error("Impossible d'enregistrer votre retour");
    } else {
      toast.success(value === 1 ? "Merci pour votre retour 👍" : "Retour enregistré, on s'améliore");
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Cette réponse vous a aidé ?</span>
      <button
        type="button"
        aria-label="Utile"
        onClick={() => submit(1)}
        disabled={loading}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded transition",
          rating === 1 ? "bg-emerald-500/20 text-emerald-600" : "text-muted-foreground hover:bg-secondary",
        )}
      >
        {loading && rating === 1 ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
      </button>
      <button
        type="button"
        aria-label="Pas utile"
        onClick={() => submit(-1)}
        disabled={loading}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded transition",
          rating === -1 ? "bg-rose-500/20 text-rose-600" : "text-muted-foreground hover:bg-secondary",
        )}
      >
        {loading && rating === -1 ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}
      </button>
    </div>
  );
}
