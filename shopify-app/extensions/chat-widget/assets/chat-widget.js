(function () {
  const widgets = document.querySelectorAll("[data-astra-chat-widget]");

  const getCookieBannerOffset = () => {
    const banner = document.querySelector(
      "[data-cookie-banner], #cookie-banner, .cookie-banner, .CookieBanner"
    );
    if (!(banner instanceof HTMLElement)) {
      return 24;
    }
    const rect = banner.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    if (rect.bottom > 0 && rect.top < viewportHeight) {
      const overlap = viewportHeight - rect.top;
      return Math.max(24, overlap + 16);
    }
    return 24;
  };

  const updateBottomOffset = () => {
    const nextOffset = getCookieBannerOffset();
    widgets.forEach((widget) => {
      widget.style.setProperty("--astra-chat-bottom", `${nextOffset}px`);
    });
  };

  const initWidget = (widget) => {
    const panel = widget.querySelector(".astra-chat-panel");
    const launcher = widget.querySelector(".astra-chat-launcher");
    const closeButton = widget.querySelector(".astra-chat-close");
    const input = widget.querySelector(".astra-chat-input");

    if (!(panel instanceof HTMLElement) || !(launcher instanceof HTMLElement)) {
      return;
    }

    const openChat = () => {
      panel.classList.add("is-open");
      launcher.classList.add("is-hidden");
      if (input instanceof HTMLElement) {
        input.focus();
      }
    };

    const closeChat = () => {
      panel.classList.remove("is-open");
      launcher.classList.remove("is-hidden");
      launcher.focus();
    };

    launcher.addEventListener("click", openChat);
    if (closeButton instanceof HTMLElement) {
      closeButton.addEventListener("click", closeChat);
    }
  };

  widgets.forEach((widget) => {
    initWidget(widget);
  });

  updateBottomOffset();
  window.addEventListener("resize", updateBottomOffset);
  window.addEventListener("scroll", updateBottomOffset);
})();
