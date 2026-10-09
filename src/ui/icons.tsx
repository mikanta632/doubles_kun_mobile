/** アイコン。線は currentColor なので、まわりの文字と同じ色になる。 */

const attrs = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" } as const;

export function MatchesIcon() {
  return (
    <svg {...attrs}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16M3 12h18" />
    </svg>
  );
}

export function MembersIcon() {
  return (
    <svg {...attrs}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18 14.8c1.8.7 3 2.5 3.5 5.2" />
    </svg>
  );
}

export function DashboardIcon() {
  return (
    <svg {...attrs}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...attrs}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

/** まとめて組む（重なった層） */
export function LayersIcon() {
  return (
    <svg {...attrs}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17.5 9 5 9-5" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...attrs} width={16} height={16} stroke-width={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...attrs} width={20} height={20}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg {...attrs} width={16} height={16} stroke-width={2}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronRight() {
  return (
    <svg {...attrs} width={18} height={18} stroke-width={1.8}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronLeft() {
  return (
    <svg {...attrs} width={18} height={18} stroke-width={1.8}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...attrs} width={16} height={16} stroke-width={2}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

export function NoteIcon() {
  return (
    <svg {...attrs} width={16} height={16} stroke-width={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...attrs} width={18} height={18} stroke-width={1.8}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function ExternalIcon() {
  return (
    <svg {...attrs} width={16} height={16} stroke-width={1.8}>
      <path d="M14 4h6v6M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}
