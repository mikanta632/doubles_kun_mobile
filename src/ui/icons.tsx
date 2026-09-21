/** 下部タブのアイコン。線は currentColor なので、選択中は文字と同じ色になる。 */

const attrs = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

export function MembersIcon() {
  return (
    <svg {...attrs}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3.4 2.4-5.8 5.5-5.8s5.5 2.4 5.5 5.8" />
      <circle cx="16.8" cy="9.2" r="2.6" />
      <path d="M16 14.2c2.7.2 4.7 2.4 4.7 5.3" />
    </svg>
  );
}

export function MatchesIcon() {
  return (
    <svg {...attrs}>
      <ellipse cx="14.5" cy="8.5" rx="4.6" ry="6" transform="rotate(40 14.5 8.5)" />
      <path d="M11 13.2 4.5 19.7" stroke-width="2.2" />
      <path d="M12.3 5.6l4.7 5.9M16.2 4.6l-4.6 6.1" opacity="0.55" />
      <circle cx="18.6" cy="18.4" r="2.3" />
    </svg>
  );
}

export function DashboardIcon() {
  return (
    <svg {...attrs}>
      <path d="M3.5 20.5h17" />
      <rect x="5.5" y="11" width="3.6" height="7" rx="0.8" />
      <rect x="10.2" y="5" width="3.6" height="13" rx="0.8" />
      <rect x="14.9" y="8.5" width="3.6" height="9.5" rx="0.8" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...attrs}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" class="knob" />
      <circle cx="15.5" cy="12" r="2.2" class="knob" />
      <circle cx="8" cy="17" r="2.2" class="knob" />
    </svg>
  );
}
