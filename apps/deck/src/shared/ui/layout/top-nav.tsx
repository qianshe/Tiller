import type { DeckLanguage } from "../../config/deck-language";
import { NAV_LABELS, type AppView } from "../../utils/routes";

type TopNavProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  connection: "connecting" | "connected" | "disconnected";
  language: DeckLanguage;
};

export function TopNav({
  activeView,
  onNavigate,
  connection,
  language,
}: TopNavProps) {
  const labels = NAV_LABELS[language];
  const items: { id: AppView; label: string }[] = [
    { id: "overview", label: labels.overview },
    { id: "sessions", label: labels.sessions },
    { id: "agents", label: labels.agents },
    { id: "settings", label: labels.settings },
  ];

  return (
    <header className="top-nav card">
      <div className="top-nav-brand">
        <span className="top-nav-logo" aria-hidden="true">
          <svg className="top-nav-logo-mark" viewBox="0 0 32 28" role="presentation">
            <path
              d="M16 0 31 28H24.2l-2.9-5.7h-3.1l2.4 5.7h-9.1l2.4-5.7h-3.1L7.8 28H1z"
              fill="currentColor"
            />
            <path d="M14.6 16.8h2.8l-1.4-3.5z" fill="#ffffff" />
          </svg>
        </span>
        <strong>Tiller</strong>
      </div>
      <nav className="top-nav-links" aria-label="主导航">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`top-nav-item ${activeView === item.id ? "active" : ""}`}
            onClick={(event) => {
              onNavigate(item.id);
              event.currentTarget.blur();
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <button
        className={`admiral-avatar admiral-${connection}`}
        type="button"
        aria-label="党徽状态标识"
      >
        <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
          <defs>
            <radialGradient
              id="emblem-black"
              cx="28"
              cy="22"
              r="38"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#151515" />
              <stop offset="1" stopColor="#000000" />
            </radialGradient>
            <linearGradient
              id="emblem-gold"
              x1="12"
              x2="52"
              y1="8"
              y2="58"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#fde68a" />
              <stop offset="0.34" stopColor="#facc15" />
              <stop offset="1" stopColor="#d97706" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="30" fill="url(#emblem-black)" />
          <text
            x="31.4"
            y="56"
            fill="url(#emblem-gold)"
            fontFamily="'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Arial Unicode MS', sans-serif"
            fontSize="57"
            fontWeight="900"
            textAnchor="middle"
          >
            ☭
          </text>
          <circle
            cx="32"
            cy="32"
            r="29"
            fill="none"
            stroke="rgba(250, 204, 21, 0.44)"
            strokeWidth="1.4"
          />
        </svg>
      </button>
    </header>
  );
}
