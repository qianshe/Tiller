import { useEffect, useRef, useState } from "react";
import type { DeckLanguage } from "../../config/deck-language";
import { NAV_LABELS, type AppView } from "../../utils/routes";

const TILLER_REPOSITORY_URL = "https://github.com/qianshe/Tiller";
const LANDING_MUSIC_URL = "/landing/cornfield-chase-hans-zimmer.mp3";

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
  const showLandingMusic = activeView === "overview";
  const showGlobalMenu = activeView !== "overview";
  const navRef = useRef<HTMLElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const items: { id: AppView; label: string }[] = [
    { id: "overview", label: labels.overview },
    { id: "sessions", label: labels.sessions },
    { id: "agents", label: labels.agents },
    { id: "settings", label: labels.settings },
  ];

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeView]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    function closeMobileMenuOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || navRef.current?.contains(target)) {
        return;
      }
      setMobileMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeMobileMenuOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeMobileMenuOnOutsidePointer);
    };
  }, [mobileMenuOpen]);

  const toggleLandingMusic = () => {
    const music = musicRef.current;
    if (!music) {
      return;
    }

    if (music.paused) {
      void music.play().then(() => setIsMusicPlaying(true)).catch(() => setIsMusicPlaying(false));
      return;
    }

    music.pause();
    setIsMusicPlaying(false);
  };

  function navigateFromMenu(view: AppView) {
    onNavigate(view);
    setMobileMenuOpen(false);
  }

  return (
    <header ref={navRef} className="top-nav">
      <button
        className="top-nav-brand"
        type="button"
        aria-label="返回首页"
        onClick={(event) => {
          onNavigate("overview");
          event.currentTarget.blur();
        }}
      >
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
      </button>
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
      <div className="top-nav-actions">
        <a
          className={`admiral-avatar top-nav-github-link admiral-${connection} ${showLandingMusic ? "top-nav-github-link-mobile-visible" : ""}`}
          href={TILLER_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="打开 Tiller GitHub 仓库"
          title="GitHub：qianshe/Tiller"
        >
          <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.16c-3.22.7-3.9-1.38-3.9-1.38-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.72 0-1.26.45-2.3 1.2-3.1-.12-.3-.52-1.48.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.58.24 2.77.12 3.06.75.8 1.2 1.84 1.2 3.1 0 4.45-2.71 5.43-5.29 5.71.42.36.79 1.07.79 2.16v3.2c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 .5Z"
            />
          </svg>
        </a>
        {showGlobalMenu ? (
          <button
            className="top-nav-menu-trigger"
            type="button"
            aria-label="打开全局导航菜单"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            ☰
          </button>
        ) : null}
        {showLandingMusic ? (
          <>
            <button
              className={`landing-cd-player ${isMusicPlaying ? "is-playing" : ""}`}
              type="button"
              onClick={toggleLandingMusic}
              aria-label={isMusicPlaying ? "暂停首页音乐" : "播放首页音乐"}
              title="Cornfield Chase - Hans Zimmer"
            >
              <span className="landing-cd-disc" aria-hidden="true" />
            </button>
            <audio
              ref={musicRef}
              src={LANDING_MUSIC_URL}
              preload="none"
              loop
              onPause={() => setIsMusicPlaying(false)}
              onPlay={() => setIsMusicPlaying(true)}
            />
          </>
        ) : null}
      </div>
      {mobileMenuOpen ? (
        <nav className="top-nav-mobile-menu" aria-label="移动端全局导航">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`top-nav-mobile-item ${activeView === item.id ? "active" : ""}`}
              onClick={() => navigateFromMenu(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
