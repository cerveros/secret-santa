import { supabase } from "./supabase-client.js";
import {
  escapeHtml,
  getStoreMetadata,
  getUrlParam,
  hideElement,
  initSnowfall,
  isValidUrl,
  normalizeUrl,
  parseSuggestions,
  serializeSuggestions,
  showElement,
  showToast,
} from "./utils.js";

initSnowfall();

const matchId = getUrlParam("id");
if (!matchId) {
  document.body.innerHTML = `
    <div class="container" style="text-align:center;">
      <h1>⚠️ Enlace Inválido</h1>
      <p class="subtitle">El enlace que has abierto está incompleto. Pide al organizador que te lo vuelva a enviar.</p>
    </div>
  `;
}

let giverId = null;
let myLinks = [];

async function init() {
  if (!matchId) return;

  const { data: match, error } = await supabase
    .from("matches")
    .select(
      `
        *,
        giver:participants!matches_giver_id_fkey(id, name, suggestions),
        receiver:participants!matches_receiver_id_fkey(name, suggestions)
      `,
    )
    .eq("id", matchId)
    .single();

  hideElement("loading");

  if (error || !match || !match.giver || !match.receiver) {
    document.body.innerHTML = `
      <div class="container" style="text-align:center;">
        <h1>❄️ Enlace caducado o no encontrado</h1>
        <p class="subtitle">Es posible que el organizador haya repetido el sorteo y generado enlaces nuevos.</p>
      </div>
    `;
    return;
  }

  showElement("content");

  giverId = match.giver.id;
  document.getElementById("greeting").textContent = `¡Hola, ${match.giver.name}!`;
  document.getElementById("target-name").textContent = match.receiver.name;

  // Load current user's own wishes & store links
  const myParsed = parseSuggestions(match.giver.suggestions);
  document.getElementById("my-wishes").value = myParsed.text;
  myLinks = myParsed.links;
  renderMyLinks();

  // Render target's wishes & store links
  renderTargetWishes(match.receiver.suggestions);
}

function renderTargetWishes(rawSuggestions) {
  const parsed = parseSuggestions(rawSuggestions);
  const hasText = parsed.text.length > 0;
  const hasLinks = parsed.links.length > 0;

  const emptyEl = document.getElementById("target-empty-wishes");
  const textEl = document.getElementById("target-wish-text");
  const linksContainerEl = document.getElementById("target-links-container");
  const linksGridEl = document.getElementById("target-wish-links");

  if (!hasText && !hasLinks) {
    showElement("target-empty-wishes");
    hideElement("target-wish-text");
    hideElement("target-links-container");
    return;
  }

  hideElement("target-empty-wishes");

  if (hasText) {
    textEl.textContent = parsed.text;
    showElement("target-wish-text");
  } else {
    hideElement("target-wish-text");
  }

  if (hasLinks) {
    showElement("target-links-container");
    linksGridEl.innerHTML = parsed.links
      .map((item) => {
        const meta = getStoreMetadata(item.url);
        const displayTitle = item.title || `Ver producto en ${meta.name}`;
        const safeUrl = escapeHtml(normalizeUrl(item.url));
        return `
          <a
            href="${safeUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="store-link-card"
          >
            <div class="store-link-info">
              <div class="store-icon-badge">${meta.icon}</div>
              <div class="store-link-text">
                <span class="store-link-title">${escapeHtml(displayTitle)}</span>
                <span class="store-link-domain">${escapeHtml(meta.name)} · ${escapeHtml(meta.domain)}</span>
              </div>
            </div>
            <span class="store-link-cta">Ver en tienda ↗</span>
          </a>
        `;
      })
      .join("");
  } else {
    hideElement("target-links-container");
  }
}

function renderMyLinks() {
  const container = document.getElementById("my-links-list");
  if (myLinks.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = myLinks
    .map((item, idx) => {
      const meta = getStoreMetadata(item.url);
      const displayTitle = item.title || `Producto en ${meta.name}`;
      const safeUrl = escapeHtml(normalizeUrl(item.url));
      return `
        <div class="store-link-card">
          <div class="store-link-info">
            <div class="store-icon-badge">${meta.icon}</div>
            <div class="store-link-text">
              <span class="store-link-title">${escapeHtml(displayTitle)}</span>
              <a
                href="${safeUrl}"
                target="_blank"
                rel="noopener noreferrer"
                class="store-link-domain"
                style="text-decoration: underline; color: var(--color-secondary);"
              >
                ${escapeHtml(meta.name)} (${escapeHtml(meta.domain)}) ↗
              </a>
            </div>
          </div>
          <button
            type="button"
            class="btn-danger"
            onclick="window.removeMyLink(${idx})"
            title="Quitar enlace"
          >
            🗑️ Quitar
          </button>
        </div>
      `;
    })
    .join("");
}

function tryAddPendingLink(silentIfEmpty = false) {
  const titleInput = document.getElementById("new-link-title");
  const urlInput = document.getElementById("new-link-url");
  const rawUrl = urlInput.value.trim();
  const rawTitle = titleInput.value.trim();

  if (!rawUrl) {
    if (!silentIfEmpty) {
      showToast("Introduce primero la dirección (URL) de la tienda", "warning");
      urlInput.focus();
    }
    return true;
  }

  if (!isValidUrl(rawUrl)) {
    showToast(
      "El enlace no parece válido. Ejemplo: https://www.amazon.es/...",
      "error",
    );
    urlInput.focus();
    return false;
  }

  myLinks.push({
    title: rawTitle,
    url: normalizeUrl(rawUrl),
  });

  titleInput.value = "";
  urlInput.value = "";
  renderMyLinks();
  return true;
}

document.getElementById("btn-add-link").addEventListener("click", () => {
  const hadUrl = document.getElementById("new-link-url").value.trim().length > 0;
  if (tryAddPendingLink(false) && hadUrl) {
    showToast("Enlace añadido. Recuerda pulsar «Guardar» al terminar", "info");
  }
});

["new-link-title", "new-link-url"].forEach((inputId) => {
  document.getElementById(inputId).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const hadUrl =
        document.getElementById("new-link-url").value.trim().length > 0;
      if (tryAddPendingLink(false) && hadUrl) {
        showToast(
          "Enlace añadido. Recuerda pulsar «Guardar» al terminar",
          "info",
        );
      }
    }
  });
});

window.removeMyLink = (idx) => {
  myLinks.splice(idx, 1);
  renderMyLinks();
};

const revealBox = document.getElementById("reveal-box");
revealBox.addEventListener("click", function () {
  this.classList.toggle("reveal-active");
});
revealBox.addEventListener("keydown", function (e) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    this.classList.toggle("reveal-active");
  }
});

document
  .getElementById("wishlist-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    // If user typed a link in the inputs and clicked Save directly without clicking "+ Añadir", include it!
    const pendingUrl = document.getElementById("new-link-url").value.trim();
    if (pendingUrl) {
      const ok = tryAddPendingLink(true);
      if (!ok) return;
    }

    const saveBtn = document.getElementById("btn-save-wishes");
    saveBtn.disabled = true;

    const textWishes = document.getElementById("my-wishes").value;
    const serialized = serializeSuggestions(textWishes, myLinks);

    const { error } = await supabase
      .from("participants")
      .update({ suggestions: serialized })
      .eq("id", giverId);

    saveBtn.disabled = false;

    if (!error) {
      showToast("¡Tus sugerencias y enlaces se han guardado! 🎁", "success");
    } else {
      showToast("Error al guardar tus sugerencias", "error");
    }
  });

init();
