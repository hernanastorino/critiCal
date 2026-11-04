const base = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const ChevronLeft = () => (
  <svg {...base} aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronRight = () => (
  <svg {...base} aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const GearIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

/** Three pills with a connecting line, like the logo. */
export const CriticalIcon = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
    <rect x="2" y="3" width="6" height="7" rx="3" fill="currentColor" />
    <rect x="9" y="9" width="6" height="7" rx="3" fill="currentColor" opacity="0.85" />
    <rect x="16" y="14" width="6" height="7" rx="3" fill="currentColor" opacity="0.7" />
  </svg>
);

export const WeekIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M5 4v16M10 7v10M15 4v8M20 9v11" />
  </svg>
);

export const SiloIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="4" y="3" width="6" height="18" rx="3" />
    <rect x="14" y="3" width="6" height="18" rx="3" />
    <path d="M4 14h6M14 9h6" />
  </svg>
);

export const InboxIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
  </svg>
);

export const ReplanIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export const EditIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} strokeWidth={2.6} aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
