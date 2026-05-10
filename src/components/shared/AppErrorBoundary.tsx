import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * R33 — Global Error Boundary.
 * Empêche le crash complet de l'app si un composant React lance une exception.
 * Affiche un fallback minimal et permet de recharger.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log local — la collecte serveur reste à brancher ultérieurement.
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            Une erreur est survenue
          </h1>
          <p className="text-sm text-muted-foreground">
            L'application a rencontré un problème inattendu. Vous pouvez réessayer
            ou recharger la page.
          </p>
          {this.state.error?.message ? (
            <pre className="rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
          ) : null}
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={this.handleReset}>
              Réessayer
            </Button>
            <Button onClick={this.handleReload}>Recharger</Button>
          </div>
        </div>
      </div>
    );
  }
}
