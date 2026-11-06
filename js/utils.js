export function showElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

export function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

export function getUrlParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

let toastTimeout = null;
export function showToast(message, type = "info") {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  const icons = {
    success: "✨",
    error: "⚠️",
    warning: "🔔",
    info: "🎄",
  };

  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || "🎄"}</span><span>${escapeHtml(message)}</span>`;

  // Trigger reflow for animation restart
  void toast.offsetWidth;
  toast.classList.add("show");

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3400);
}

export function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Normalizes a user-entered URL, ensuring it has https:// or http://
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Validates whether a string is a plausible web URL
 */
export function isValidUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      u.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

/**
 * Extracts store branding (name + icon) from a URL
 */
export function getStoreMetadata(rawUrl) {
  try {
    const u = new URL(normalizeUrl(rawUrl));
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();

    const stores = [
      { match: "amazon", name: "Amazon", icon: "📦" },
      { match: "zara", name: "Zara", icon: "👗" },
      { match: "elcorteingles", name: "El Corte Inglés", icon: "🏬" },
      { match: "fnac", name: "Fnac", icon: "📚" },
      { match: "casadellibro", name: "Casa del Libro", icon: "📖" },
      { match: "decathlon", name: "Decathlon", icon: "🏅" },
      { match: "ikea", name: "IKEA", icon: "🏠" },
      { match: "zalando", name: "Zalando", icon: "👟" },
      { match: "nike", name: "Nike", icon: "👟" },
      { match: "adidas", name: "Adidas", icon: "👟" },
      { match: "mango", name: "Mango", icon: "👚" },
      { match: "pullandbear", name: "Pull&Bear", icon: "🧥" },
      { match: "bershka", name: "Bershka", icon: "👕" },
      { match: "stradivarius", name: "Stradivarius", icon: "👠" },
      { match: "massimodutti", name: "Massimo Dutti", icon: "👔" },
      { match: "sephora", name: "Sephora", icon: "💄" },
      { match: "primor", name: "Primor", icon: "🧴" },
      { match: "druni", name: "Druni", icon: "✨" },
      { match: "pccomponentes", name: "PcComponentes", icon: "💻" },
      { match: "mediamarkt", name: "MediaMarkt", icon: "🔌" },
      { match: "apple", name: "Apple", icon: "🍎" },
      { match: "steam", name: "Steam", icon: "🎮" },
      { match: "playstation", name: "PlayStation", icon: "🎮" },
      { match: "nintendo", name: "Nintendo", icon: "🕹️" },
      { match: "game.es", name: "GAME", icon: "🎮" },
      { match: "aliexpress", name: "AliExpress", icon: "🛍️" },
      { match: "shein", name: "SHEIN", icon: "🛍️" },
      { match: "etsy", name: "Etsy", icon: "🧶" },
      { match: "lego", name: "LEGO", icon: "🧱" },
      { match: "thomann", name: "Thomann", icon: "🎸" },
    ];

    for (const s of stores) {
      if (host.includes(s.match)) {
        return { name: s.name, icon: s.icon, domain: host };
      }
    }

    // Capitalize main domain part nicely
    const parts = host.split(".");
    const mainName = parts[0]
      ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
      : host;
    return { name: mainName, icon: "🛍️", domain: host };
  } catch {
    return { name: "Tienda Online", icon: "🔗", domain: "" };
  }
}

/**
 * Parses the `suggestions` column from Supabase.
 * Backward compatible with plain text strings and JSON payloads.
 * Returns { text: string, links: Array<{ title: string, url: string }> }
 */
export function parseSuggestions(raw) {
  if (!raw || typeof raw !== "string") {
    return { text: "", links: [] };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: "", links: [] };
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const text = typeof parsed.text === "string" ? parsed.text : "";
        const links = Array.isArray(parsed.links)
          ? parsed.links
              .filter((l) => l && typeof l.url === "string" && l.url.trim())
              .map((l) => ({
                title: typeof l.title === "string" ? l.title.trim() : "",
                url: normalizeUrl(l.url),
              }))
          : [];
        return { text, links };
      }
    } catch {
      // Fallback to plain text if JSON parse fails
    }
  }

  return { text: raw, links: [] };
}

/**
 * Serializes wishes text and store links into a single string for Supabase `suggestions` column.
 */
export function serializeSuggestions(text, links = []) {
  const cleanText = (text || "").trim();
  const cleanLinks = (Array.isArray(links) ? links : [])
    .filter((l) => l && l.url && l.url.trim())
    .map((l) => ({
      title: (l.title || "").trim(),
      url: normalizeUrl(l.url),
    }));

  if (cleanLinks.length === 0) {
    return cleanText;
  }

  return JSON.stringify({
    text: cleanText,
    links: cleanLinks,
  });
}

/**
 * Renders festive floating snowflakes inside .snow-container
 */
export function initSnowfall() {
  const container = document.querySelector(".snow-container");
  if (!container || container.dataset.initialized === "true") return;
  container.dataset.initialized = "true";

  const flakeCount = 38;
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < flakeCount; i++) {
    const flake = document.createElement("span");
    flake.className = "snowflake";
    const size = (Math.random() * 5 + 2.5).toFixed(1);
    const left = (Math.random() * 100).toFixed(2);
    const duration = (Math.random() * 10 + 8).toFixed(2);
    const delay = (Math.random() * -18).toFixed(2);
    const opacity = (Math.random() * 0.55 + 0.2).toFixed(2);
    const drift = (Math.random() * 60 - 30).toFixed(0);

    flake.style.width = `${size}px`;
    flake.style.height = `${size}px`;
    flake.style.left = `${left}%`;
    flake.style. opacity = opacity;
    flake.style.animationDuration = `${duration}s`;
    flake.style.animationDelay = `${delay}s`;
    flake.style.setProperty("--drift", `${drift}px`);

    fragment.appendChild(flake);
  }

  container.appendChild(fragment);
}
