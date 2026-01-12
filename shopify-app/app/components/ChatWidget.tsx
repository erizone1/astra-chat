import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import styles from "./ChatWidget.module.css";

type ChatWidgetProps = {
  brandName?: string;
  brandColor?: string;
  showOnlineIndicator?: boolean;
};

export default function ChatWidget({
  brandName = "Modavinio",
  brandColor = "#4f46e5",
  showOnlineIndicator = true,
}: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [bottomOffset, setBottomOffset] = useState(24);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const updateOffset = () => {
      const banner = document.querySelector<HTMLElement>(
        "[data-cookie-banner], #cookie-banner, .cookie-banner, .CookieBanner"
      );
      if (!banner) {
        setBottomOffset(24);
        return;
      }
      const rect = banner.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > 0 && rect.top < viewportHeight) {
        const overlap = viewportHeight - rect.top;
        const nextOffset = Math.max(24, overlap + 16);
        setBottomOffset(nextOffset);
      } else {
        setBottomOffset(24);
      }
    };

    updateOffset();
    window.addEventListener("resize", updateOffset);
    window.addEventListener("scroll", updateOffset);
    return () => {
      window.removeEventListener("resize", updateOffset);
      window.removeEventListener("scroll", updateOffset);
    };
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    launcherRef.current?.focus();
  };

  return (
    <div
      className={styles.widget}
      style={
        {
          "--chat-widget-bottom": `${bottomOffset}px`,
          "--chat-widget-brand": brandColor,
        } as CSSProperties
      }
    >
      <div className={`${styles.panel} ${isOpen ? styles.panelOpen : ""}`}>
        <div className={styles.panelHeader}>
          <div className={styles.headerTitle}>
            <span className={styles.brandName}>{brandName}</span>
            <span className={styles.statusRow}>
              <span className={styles.statusDot} aria-hidden="true" />
              We are online
            </span>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close chat"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.messageArea}>
            Hi there! 👋 How can we help you today?
          </div>
          <div className={styles.quickActions}>
            <button type="button" className={styles.quickAction}>
              Order status
            </button>
            <button type="button" className={styles.quickAction}>
              Shipping info
            </button>
            <button type="button" className={styles.quickAction}>
              Talk to support
            </button>
          </div>
          <div className={styles.inputBar}>
            <input
              ref={inputRef}
              className={styles.input}
              placeholder="Type your message..."
              aria-label="Message input"
            />
            <button type="button" className={styles.sendButton} aria-label="Send">
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2.94 2.94a1.5 1.5 0 012.12 0L17 14.88a1 1 0 01-1.03 1.71l-5.12-1.46-1.46 5.12A1 1 0 018.68 20H8.5a1 1 0 01-.96-1.28l1.76-6.16-6.16 1.76A1 1 0 011.28 12V11.8a1.5 1.5 0 010-2.12L2.94 2.94z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <button
        ref={launcherRef}
        type="button"
        className={`${styles.launcher} ${isOpen ? styles.launcherHidden : ""}`}
        onClick={handleOpen}
        aria-label="Open chat"
      >
        <svg
          className={styles.launcherIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4z" />
        </svg>
        {showOnlineIndicator && (
          <span className={styles.launcherOnlineDot} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
