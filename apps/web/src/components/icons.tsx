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

/** Icons for the rows of Ajustes, same 2px line as the rest. */
const line = (d: string) => () => (
  <svg {...base} width={18} height={18} aria-hidden="true">
    <path d={d} />
  </svg>
);

export const SettingsIcons = {
  sun: line(
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  ),
  plan: line(
    "M6 4h12a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM3 9h18M8 2v4M16 2v4M8 14h3M8 17h6",
  ),
  flag: line("M5 21V4M5 4h11l-2 4 2 4H5"),
  doc: line(
    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 18v-6M9 15l3-3 3 3",
  ),
  clock: line("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2"),
  book: line("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6"),
  repeat: line("M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"),
  rules: line(
    "M4 6h10M4 12h16M4 18h7M17 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM14 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  ),
  radar: line("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12l6-6"),
  pin: line(
    "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  ),
  link: line(
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ),
  bell: line("M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"),
  grid: line(
    "M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z",
  ),
  spark: line("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"),
  users: line(
    "M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5",
  ),
  box: line("M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"),
  shield: line("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"),
  out: line("M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11"),
  trash: line("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"),
  warn: line("M12 3l10 18H2zM12 10v5M12 18h.01"),
};
