import { createContext, type ReactNode, useContext } from "react";

/** Whether the Ajustes screen holding this section is the one on view. */
export const SectionOpen = createContext(true);

/** True while this section's screen is on view (lazy content waits for it). */
export const useSectionOpen = () => useContext(SectionOpen);

/** One Ajustes section's content. Its screen in Settings shows the title and «Atrás». */
export function Section({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`card prefs${className ? ` ${className}` : ""}`}>{children}</div>;
}
