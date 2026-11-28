import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { reportError } from "../monitoring.js";
import { useToast } from "./Toast.js";

/** A failure inside the sheet closes it with a notice: the rest of the app keeps standing. */
export class SheetBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const err = error instanceof Error ? error : new Error(String(error));
    reportError(err, { componentStack: (info.componentStack ?? "").slice(0, 2000) });
    this.props.onClose();
  }

  override render() {
    return this.state.failed ? <SheetFailed /> : this.props.children;
  }
}

/** Shown once, as the sheet goes away. */
function SheetFailed() {
  const toast = useToast();
  // biome-ignore lint/correctness/useExhaustiveDependencies: said once, as it mounts
  useEffect(() => {
    toast.show("No pude abrir el reparto. Probá de nuevo.", { tone: "alert" });
  }, []);
  return null;
}
