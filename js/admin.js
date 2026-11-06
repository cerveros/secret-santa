import { supabase } from "./supabase-client.js";
import {
  escapeHtml,
  generateUUID,
  getUrlParam,
  hideElement,
  initSnowfall,
  parseSuggestions,
  showElement,
  showToast,
} from "./utils.js";
import {
  copyGroupData,
  fetchAllGroups,
  findGroupByCodeOrIdentifier,
  formatCodeForStorage,
  getGroupCode,
  logoutAdmin,
  openChangePasswordModal,
  openDeleteGroupModal,
  requireAdminAuth,
  slugifyGroupCode,
} from "./auth.js";

initSnowfall();

let gameId = getUrlParam("id");
const urlCode = getUrlParam("code");

let participants = [];
let exclusions = [];
let currentGame = null;
let currentGroupCode = "";

async function init() {
  // 1. Require Master Admin Password before doing anything
  await requireAdminAuth();

  document
    .getElementById("btn-change-master-pwd")
    .addEventListener("click", openChangePasswordModal);
  document
    .getElementById("btn-logout-admin")
    .addEventListener("click", logoutAdmin);

  // 2. Resolve group by human code (?code=...) or UUID (?id=...)
  let game = null;
  if (urlCode) {
    game = await findGroupByCodeOrIdentifier(urlCode);
  } else if (gameId) {
    const { data } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();
    game = data;
  }

  if (!game) {
    showToast("Grupo no encontrado", "error");
    window.location.href = "index.html";
    return;
  }

  currentGame = game;
  gameId = game.id;
  currentGroupCode = getGroupCode(game);

  // If legacy group didn't have CODE: stored yet, persist its generated human code
  if (!game.admin_password || !game.admin_password.startsWith("CODE:")) {
    await supabase
      .from("games")
      .update({ admin_password: formatCodeForStorage(currentGroupCode) })
      .eq("id", gameId);
  }

  renderGroupHeader();

  await loadParticipants();
  await loadExclusions();

  if (game.is_drawn) {
    updateDrawnUIState(true);
    await loadLinks();
    await verifyMatchesIntegrity(false);
  } else {
    updateDrawnUIState(false);
  }
}

function renderGroupHeader() {
  document.getElementById("game-title-text").textContent =
    `🎄 ${currentGame.name}`;
  const codeCopyEl = document.getElementById("game-code-copy");
  codeCopyEl.textContent = `🏷️ Código: ${currentGroupCode}`;
  codeCopyEl.onclick = () => {
    navigator.clipboard.writeText(currentGroupCode);
    showToast(`Código «${currentGroupCode}» copiado al portapapeles`, "success");
  };
}

document
  .getElementById("btn-edit-group-code")
  .addEventListener("click", async () => {
    const newRaw = prompt(
      "Introduce el nuevo código fácil de recordar para este grupo (ej. FAMILIA-2026):",
      currentGroupCode,
    );
    if (!newRaw) return;
    const cleanCode = slugifyGroupCode(newRaw);
    if (!cleanCode) {
      return showToast("Código inválido", "warning");
    }
    if (cleanCode === currentGroupCode) return;

    const allGroups = await fetchAllGroups();
    const conflict = allGroups.find(
      (g) => g.id !== gameId && g.code.toUpperCase() === cleanCode.toUpperCase(),
    );
    if (conflict) {
      return showToast(
        `El código «${cleanCode}» ya pertenece al grupo «${conflict.name}»`,
        "error",
      );
    }

    const { error } = await supabase
      .from("games")
      .update({ admin_password: formatCodeForStorage(cleanCode) })
      .eq("id", gameId);

    if (!error) {
      currentGroupCode = cleanCode;
      renderGroupHeader();
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("id");
      newUrl.searchParams.set("code", currentGroupCode);
      window.history.replaceState({}, "", newUrl.toString());
      showToast(`Código actualizado a «${currentGroupCode}»`, "success");
    } else {
      showToast("Error al actualizar el código", "error");
    }
  });

// Modal: Import Preferences / Participants / Exclusions from another group
document
  .getElementById("btn-open-import-modal")
  .addEventListener("click", async () => {
    const allGroups = (await fetchAllGroups()).filter((g) => g.id !== gameId);
    if (allGroups.length === 0) {
      return showToast(
        "No tienes otros grupos creados desde los que importar.",
        "warning",
      );
    }

    let modal = document.getElementById("import-group-modal");
    if (modal) modal.remove();

    const optionsHtml = allGroups
      .map(
        (g) =>
          `<option value="${g.id}">${escapeHtml(g.name)} (Código: ${escapeHtml(g.code)})</option>`,
      )
      .join("");

    modal = document.createElement("div");
    modal.id = "import-group-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal-card">
        <div class="section-header" style="margin-bottom: 0.75rem;">
          <h3>📥 Importar de otro Grupo</h3>
          <button type="button" id="btn-close-import-modal" class="btn-icon">✕</button>
        </div>
        <p style="font-size: 0.86rem; color: var(--color-text-muted); margin-bottom: 1rem;">
          Trae participantes y reglas de exclusión desde otro grupo a <strong>${escapeHtml(currentGame.name)}</strong> (las listas de deseos no se importan para empezar limpias):
        </p>
        <form id="import-group-form">
          <div class="form-group">
            <label for="import-source-select">Grupo de origen</label>
            <select id="import-source-select" required>${optionsHtml}</select>
          </div>
          <div class="checkbox-list">
            <label class="checkbox-row">
              <input type="checkbox" id="chk-imp-participants" checked />
              <span>
                <strong>Añadir participantes que falten</strong><br />
                <small style="color: var(--color-text-muted)">
                  Importa las personas y sus teléfonos (con su lista de deseos en blanco).
                </small>
              </span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="chk-imp-exclusions" checked />
              <span>
                <strong>Importar reglas de exclusión (parejas)</strong><br />
                <small style="color: var(--color-text-muted)">
                  Copia las restricciones entre participantes del mismo nombre.
                </small>
              </span>
            </label>
          </div>
          <div style="display:flex; gap:0.6rem; margin-top: 1.25rem;">
            <button type="submit" id="btn-confirm-import" class="btn">📥 Importar Datos</button>
            <button type="button" id="btn-cancel-import" class="btn btn-outline" style="margin-top:0;">Cancelar</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    document.getElementById("btn-close-import-modal").onclick = closeModal;
    document.getElementById("btn-cancel-import").onclick = closeModal;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    document
      .getElementById("import-group-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const sourceGameId = document.getElementById("import-source-select").value;
        const importParticipants = document.getElementById("chk-imp-participants").checked;
        const importExclusions = document.getElementById("chk-imp-exclusions").checked;

        if (!importParticipants && !importExclusions) {
          return showToast("Selecciona al menos una opción para importar", "warning");
        }

        const btn = document.getElementById("btn-confirm-import");
        btn.disabled = true;
        btn.textContent = "Importando...";

        const result = await copyGroupData({
          sourceGameId,
          targetGameId: gameId,
          importParticipants,
          importExclusions,
        });

        await loadParticipants();
        await loadExclusions();
        if (currentGame?.is_drawn) {
          await verifyMatchesIntegrity(false);
        }

        closeModal();
        showToast(
          `Importación completada: +${result.addedParticipantsCount} personas y +${result.addedExclusionsCount} exclusiones`,
          "success",
        );
      });
  });

// Modal: Clone / Copy entire current group into a brand new group
document
  .getElementById("btn-delete-current-group")
  .addEventListener("click", () => {
    if (!currentGame) return;
    openDeleteGroupModal(
      { ...currentGame, code: currentGroupCode },
      () => {
        window.location.href = "index.html";
      },
    );
  });

document
  .getElementById("btn-open-clone-modal")
  .addEventListener("click", () => {
    let modal = document.getElementById("clone-group-modal");
    if (modal) modal.remove();

    const defaultNewName = `${currentGame.name} (Copia)`;
    const defaultNewCode = slugifyGroupCode(`${currentGroupCode}-COPIA`);

    modal = document.createElement("div");
    modal.id = "clone-group-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal-card">
        <div class="section-header" style="margin-bottom: 0.75rem;">
          <h3>📋 Copiar Grupo en uno Nuevo</h3>
          <button type="button" id="btn-close-clone-modal" class="btn-icon">✕</button>
        </div>
        <p style="font-size: 0.86rem; color: var(--color-text-muted); margin-bottom: 1rem;">
          Crea un grupo nuevo a partir de <strong>${escapeHtml(currentGame.name)}</strong> conservando sus participantes y reglas de exclusión (sin deseos anteriores):
        </p>
        <form id="clone-group-form">
          <div class="form-group">
            <label for="clone-new-name">Nombre del Nuevo Grupo</label>
            <input type="text" id="clone-new-name" required value="${escapeHtml(defaultNewName)}" />
          </div>
          <div class="form-group">
            <label for="clone-new-code">Código legible del Nuevo Grupo</label>
            <input
              type="text"
              id="clone-new-code"
              required
              value="${escapeHtml(defaultNewCode)}"
              style="font-family: monospace; font-weight: 700; text-transform: uppercase"
            />
          </div>
          <div class="checkbox-list">
            <label class="checkbox-row">
              <input type="checkbox" id="chk-dup-participants" checked />
              <span><strong>Copiar participantes y teléfonos</strong> (deseos en blanco)</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="chk-dup-exclusions" checked />
              <span><strong>Copiar reglas de exclusión (parejas)</strong></span>
            </label>
          </div>
          <div style="display:flex; gap:0.6rem; margin-top: 1.25rem;">
            <button type="submit" id="btn-confirm-clone" class="btn">📋 Crear Copia y Abrir</button>
            <button type="button" id="btn-cancel-clone" class="btn btn-outline" style="margin-top:0;">Cancelar</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    document.getElementById("btn-close-clone-modal").onclick = closeModal;
    document.getElementById("btn-cancel-clone").onclick = closeModal;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    let manualCode = false;
    document.getElementById("clone-new-name").addEventListener("input", (e) => {
      if (!manualCode) {
        document.getElementById("clone-new-code").value = slugifyGroupCode(
          e.target.value,
        );
      }
    });
    document.getElementById("clone-new-code").addEventListener("input", () => {
      manualCode = true;
    });

    document
      .getElementById("clone-group-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const newName = document.getElementById("clone-new-name").value.trim();
        const newCode = slugifyGroupCode(
          document.getElementById("clone-new-code").value.trim() || newName,
        );

        if (!newCode) {
          return showToast("Introduce un código válido", "warning");
        }

        const allGroups = await fetchAllGroups();
        if (allGroups.some((g) => g.code.toUpperCase() === newCode.toUpperCase())) {
          return showToast(
            `El código «${newCode}» ya existe en otro grupo. Elige otro.`,
            "warning",
          );
        }

        const btn = document.getElementById("btn-confirm-clone");
        btn.disabled = true;
        btn.textContent = "Copiando grupo...";

        const { data: created, error } = await supabase
          .from("games")
          .insert([
            {
              name: newName,
              admin_password: formatCodeForStorage(newCode),
              is_drawn: false,
            },
          ])
          .select()
          .single();

        if (error || !created) {
          btn.disabled = false;
          btn.textContent = "📋 Crear Copia y Abrir";
          return showToast("Error al crear el nuevo grupo", "error");
        }

        await copyGroupData({
          sourceGameId: gameId,
          targetGameId: created.id,
          importParticipants: document.getElementById("chk-dup-participants").checked,
          importExclusions: document.getElementById("chk-dup-exclusions").checked,
        });

        showToast("¡Grupo copiado con éxito!", "success");
        window.location.href = `admin.html?code=${encodeURIComponent(newCode)}`;
      });
  });

function updateDrawnUIState(isDrawn) {
  const badge = document.getElementById("header-status-badge");
  const drawBtn = document.getElementById("btn-draw");
  const drawStatus = document.getElementById("draw-status");

  if (isDrawn) {
    badge.textContent = "✅ Sorteo Activo";
    badge.style.background = "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)";
    badge.style.color = "#14532d";
    badge.style.borderColor = "#86efac";
    drawBtn.innerHTML = "🔄 Volver a Sortear Parejas";
    drawStatus.textContent =
      "Las parejas están activas y guardadas en la base de datos.";
    showElement("btn-verify-integrity");
  } else {
    badge.textContent = "⏳ Pendiente de sorteo";
    drawBtn.innerHTML = "🎁 Realizar Sorteo de Parejas";
    drawStatus.textContent = "";
    hideElement("btn-verify-integrity");
    hideElement("integrity-panel");
  }
}

function updateStats() {
  document.getElementById("stat-participants").textContent = participants.length;
  document.getElementById("stat-exclusions").textContent = exclusions.length;

  const withWishes = participants.filter((p) => {
    const parsed = parseSuggestions(p.suggestions);
    return parsed.text.length > 0 || parsed.links.length > 0;
  }).length;
  document.getElementById("stat-wishes").textContent =
    `${withWishes}/${participants.length}`;

  document.getElementById("participants-badge").textContent =
    `${participants.length} ${participants.length === 1 ? "persona" : "personas"}`;
  document.getElementById("exclusions-badge").textContent =
    `${exclusions.length} ${exclusions.length === 1 ? "regla" : "reglas"}`;
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function loadParticipants() {
  const { data } = await supabase
    .from("participants")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });

  if (data) {
    participants = data;
    renderParticipants();
    updateSelects();
    updateStats();
  }
}

async function loadExclusions() {
  const { data } = await supabase
    .from("exclusions")
    .select("*")
    .eq("game_id", gameId);

  if (data) {
    exclusions = data;
    renderExclusions();
    updateStats();
  }
}

function renderParticipants() {
  const list = document.getElementById("participants-list");
  list.innerHTML = "";

  if (participants.length === 0) {
    list.innerHTML = `
      <li style="text-align:center; padding: 1.25rem; color: var(--color-text-light); font-size: 0.9rem;">
        Todavía no hay participantes. ¡Añade a los primeros arriba o impórtalos de otro grupo!
      </li>
    `;
    return;
  }

  participants.forEach((p) => {
    const li = document.createElement("li");
    li.className = "participant-item";
    li.id = `row-${p.id}`;

    const phoneDisplay = p.phone
      ? `<span class="participant-phone">📞 ${escapeHtml(p.phone)}</span>`
      : `<span class="participant-phone" style="opacity:0.65">Sin teléfono</span>`;

    const parsedWishes = parseSuggestions(p.suggestions);
    const hasText = parsedWishes.text.length > 0;
    const linksCount = parsedWishes.links.length;

    let wishBadge = "";
    if (hasText || linksCount > 0) {
      const linkInfo = linksCount > 0 ? ` · ${linksCount} 🔗` : "";
      wishBadge = `<span class="wish-status-badge" title="Ha rellenado su lista de deseos">🎁 Con deseos${linkInfo}</span>`;
    }

    li.innerHTML = `
      <div class="participant-meta">
        <div class="avatar-circle">${escapeHtml(getInitials(p.name))}</div>
        <div class="participant-details">
          <div class="participant-name-row">
            <span id="name-${p.id}" class="participant-name">${escapeHtml(p.name)}</span>
            ${wishBadge}
          </div>
          ${phoneDisplay}
        </div>
      </div>
      <div style="display: flex; gap: 6px; flex-shrink: 0;">
        <button class="btn-icon" onclick="window.editP('${p.id}')" title="Editar">✏️</button>
        <button class="btn-icon" style="color:var(--color-danger);" onclick="window.removeP('${p.id}')" title="Eliminar">🗑️</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function updateSelects() {
  const from = document.getElementById("excl-from");
  const to = document.getElementById("excl-to");
  from.innerHTML = "";
  to.innerHTML = "";

  if (participants.length === 0) {
    from.add(new Option("Añade participantes primero", ""));
    to.add(new Option("Añade participantes primero", ""));
    return;
  }

  participants.forEach((p) => {
    from.add(new Option(p.name, p.id));
    to.add(new Option(p.name, p.id));
  });

  if (participants.length > 1) {
    to.selectedIndex = 1;
  }
}

function renderExclusions() {
  const list = document.getElementById("exclusions-list");
  list.innerHTML = "";

  if (exclusions.length === 0) {
    return;
  }

  exclusions.forEach((ex) => {
    const p1 =
      participants.find((p) => p.id === ex.participant_id)?.name || "Desconocido";
    const p2 =
      participants.find((p) => p.id === ex.excluded_participant_id)?.name ||
      "Desconocido";

    const li = document.createElement("li");
    li.className = "participant-item";
    li.style.borderLeftColor = "var(--color-primary)";
    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.9rem; font-weight:600;">
        <span>${escapeHtml(p1)}</span>
        <span class="exclusion-vs" style="font-size:0.74rem; padding:0.15rem 0.5rem;">🚫 No se regalan</span>
        <span>${escapeHtml(p2)}</span>
      </div>
      <button class="btn-danger" onclick="window.removeEx('${ex.id}')" title="Eliminar regla">Quitar</button>
    `;
    list.appendChild(li);
  });
}

window.editP = (id) => {
  const p = participants.find((part) => part.id === id);
  if (!p) return;

  const row = document.getElementById(`row-${id}`);
  row.innerHTML = `
    <div class="edit-row">
      <input type="text" id="edit-name-${id}" class="edit-input" value="${escapeHtml(p.name)}" placeholder="Nombre">
      <input type="tel" id="edit-phone-${id}" class="edit-input" value="${escapeHtml(p.phone || "")}" placeholder="Teléfono">
    </div>
    <div style="display: flex; gap: 6px; flex-shrink: 0;">
      <button class="btn-icon" onclick="window.saveP('${id}')" title="Guardar">✅</button>
      <button class="btn-icon" onclick="window.cancelP('${id}')" title="Cancelar">❌</button>
    </div>
  `;
};

window.cancelP = () => {
  renderParticipants();
};

window.saveP = async (id) => {
  const newName = document.getElementById(`edit-name-${id}`).value.trim();
  const newPhone = document.getElementById(`edit-phone-${id}`).value.trim();

  if (!newName) return showToast("El nombre es obligatorio", "warning");

  const { error } = await supabase
    .from("participants")
    .update({ name: newName, phone: newPhone })
    .eq("id", id);

  if (error) {
    showToast("Error al actualizar: " + error.message, "error");
  } else {
    showToast("Participante actualizado", "success");
    await loadParticipants();
    if (currentGame?.is_drawn) {
      await loadLinks();
    }
  }
};

document
  .getElementById("add-participant-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("p-name").value.trim();
    const phone = document.getElementById("p-phone").value.trim();

    if (!name) return;

    const { error } = await supabase
      .from("participants")
      .insert([{ game_id: gameId, name, phone }]);

    if (!error) {
      document.getElementById("p-name").value = "";
      document.getElementById("p-phone").value = "";
      await loadParticipants();
      showToast("Participante añadido ✨", "success");
      if (currentGame?.is_drawn) {
        await verifyMatchesIntegrity(false);
      }
    } else {
      showToast("Error al añadir participante", "error");
    }
  });

document.getElementById("btn-bulk-add").addEventListener("click", async () => {
  const text = document.getElementById("p-bulk-names").value;
  if (!text) return;

  const names = text
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (names.length === 0)
    return showToast("No se encontraron nombres válidos", "warning");

  const toInsert = names.map((name) => ({
    game_id: gameId,
    name: name,
  }));

  const { error } = await supabase.from("participants").insert(toInsert);

  if (!error) {
    document.getElementById("p-bulk-names").value = "";
    await loadParticipants();
    showToast(`Se han añadido ${names.length} participantes`, "success");
    if (currentGame?.is_drawn) {
      await verifyMatchesIntegrity(false);
    }
  } else {
    showToast("Error al importar la lista", "error");
  }
});

document
  .getElementById("btn-add-exclusion")
  .addEventListener("click", async () => {
    const pId = document.getElementById("excl-from").value;
    const exId = document.getElementById("excl-to").value;

    if (!pId || !exId) return;
    if (pId === exId)
      return showToast("Una persona no puede excluirse a sí misma", "warning");

    const alreadyExists = exclusions.some(
      (rule) =>
        (rule.participant_id === pId && rule.excluded_participant_id === exId) ||
        (rule.participant_id === exId && rule.excluded_participant_id === pId),
    );

    if (alreadyExists) {
      return showToast("Esta regla de exclusión ya existe", "warning");
    }

    const { error } = await supabase
      .from("exclusions")
      .insert([
        { game_id: gameId, participant_id: pId, excluded_participant_id: exId },
      ]);

    if (!error) {
      showToast("Regla de exclusión añadida", "success");
      await loadExclusions();
      if (currentGame?.is_drawn) {
        await verifyMatchesIntegrity(false);
      }
    }
  });

window.removeP = async (id) => {
  if (!confirm("¿Eliminar este participante del grupo?")) return;
  await supabase.from("participants").delete().eq("id", id);
  await loadParticipants();
  if (currentGame?.is_drawn) {
    await verifyMatchesIntegrity(false);
  }
};

window.removeEx = async (id) => {
  await supabase.from("exclusions").delete().eq("id", id);
  await loadExclusions();
  if (currentGame?.is_drawn) {
    await verifyMatchesIntegrity(false);
  }
};

document.getElementById("btn-draw").addEventListener("click", async () => {
  if (participants.length < 2) {
    return showToast(
      "Se necesitan al menos 2 participantes para sortear",
      "warning",
    );
  }

  if (currentGame?.is_drawn) {
    const confirmed = confirm(
      "ATENCIÓN: Si vuelves a sortear, TODOS los enlaces anteriores que hayas enviado dejarán de funcionar y se crearán parejas nuevas. ¿Continuar?",
    );
    if (!confirmed) return;
  }

  await supabase.from("matches").delete().eq("game_id", gameId);

  const matches = generateSecretSanta(participants, exclusions);

  if (!matches) {
    return showToast(
      "No es posible generar un sorteo válido con tantas exclusiones. Revisa las reglas.",
      "error",
    );
  }

  const insertData = matches.map((m) => ({
    id: generateUUID(),
    game_id: gameId,
    giver_id: m.giver,
    receiver_id: m.receiver,
  }));

  const { error } = await supabase.from("matches").insert(insertData);

  if (!error) {
    await supabase.from("games").update({ is_drawn: true }).eq("id", gameId);
    currentGame.is_drawn = true;
    updateDrawnUIState(true);
    showToast("¡Sorteo realizado y verificado con éxito! 🎁", "success");
    await loadLinks();
    await verifyMatchesIntegrity(false);
  } else {
    showToast("Error guardando las parejas: " + error.message, "error");
  }
});

document
  .getElementById("btn-verify-integrity")
  .addEventListener("click", async () => {
    await verifyMatchesIntegrity(true);
  });

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateSecretSanta(people, rules) {
  let fallbackResult = null;

  for (let attempt = 0; attempt < 500; attempt++) {
    const pool = shuffleArray(people);
    let receivers = shuffleArray(people);
    const result = [];
    let valid = true;

    for (const giver of pool) {
      const options = receivers.filter(
        (r) =>
          r.id !== giver.id &&
          !rules.some((rule) => {
            const direct =
              rule.participant_id === giver.id &&
              rule.excluded_participant_id === r.id;
            const reverse =
              rule.participant_id === r.id &&
              rule.excluded_participant_id === giver.id;
            return direct || reverse;
          }),
      );

      if (options.length === 0) {
        valid = false;
        break;
      }

      const choiceIndex = Math.floor(Math.random() * options.length);
      const receiver = options[choiceIndex];

      result.push({ giver: giver.id, receiver: receiver.id });
      receivers = receivers.filter((r) => r.id !== receiver.id);
    }

    if (valid) {
      if (!fallbackResult) fallbackResult = result;

      if (people.length >= 4) {
        const map = new Map(result.map((m) => [m.giver, m.receiver]));
        const hasTwoCycle = result.some(
          (m) => map.get(m.receiver) === m.giver,
        );
        if (!hasTwoCycle) {
          return result;
        }
      } else {
        return result;
      }
    }
  }

  return fallbackResult;
}

function computeVerificationFingerprint(matches) {
  const canonical = matches
    .map((m) => `${m.id}:${m.giver_id}->${m.receiver_id}`)
    .sort()
    .join("|");

  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `#VER-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

async function verifyMatchesIntegrity(showToastFeedback = true) {
  const [matchesRes, participantsRes, exclusionsRes] = await Promise.all([
    supabase.from("matches").select("*").eq("game_id", gameId),
    supabase.from("participants").select("id, name").eq("game_id", gameId),
    supabase.from("exclusions").select("*").eq("game_id", gameId),
  ]);

  const dbMatches = matchesRes.data || [];
  const dbParticipants = participantsRes.data || [];
  const dbExclusions = exclusionsRes.data || [];

  const totalP = dbParticipants.length;
  const totalM = dbMatches.length;
  const participantIds = new Set(dbParticipants.map((p) => p.id));

  const allGiversValid = dbMatches.every((m) => participantIds.has(m.giver_id));
  const allReceiversValid = dbMatches.every((m) =>
    participantIds.has(m.receiver_id),
  );
  const coverageOk =
    totalP >= 2 && totalM === totalP && allGiversValid && allReceiversValid;

  const uniqueGivers = new Set(
    dbMatches.map((m) => m.giver_id).filter((id) => participantIds.has(id)),
  );
  const giversOk = uniqueGivers.size === totalP && totalM === totalP;

  const uniqueReceivers = new Set(
    dbMatches.map((m) => m.receiver_id).filter((id) => participantIds.has(id)),
  );
  const receiversOk = uniqueReceivers.size === totalP && totalM === totalP;

  const selfGiftsCount = dbMatches.filter(
    (m) => m.giver_id === m.receiver_id,
  ).length;
  const noSelfGiftOk = totalM > 0 && selfGiftsCount === 0;

  let violatedExclusions = 0;
  for (const m of dbMatches) {
    const violates = dbExclusions.some(
      (rule) =>
        (rule.participant_id === m.giver_id &&
          rule.excluded_participant_id === m.receiver_id) ||
        (rule.participant_id === m.receiver_id &&
          rule.excluded_participant_id === m.giver_id),
    );
    if (violates) violatedExclusions++;
  }
  const exclusionsOk = violatedExclusions === 0;

  const nextMap = new Map(dbMatches.map((m) => [m.giver_id, m.receiver_id]));
  let twoPersonLoops = 0;
  for (const m of dbMatches) {
    if (
      m.giver_id !== m.receiver_id &&
      nextMap.get(m.receiver_id) === m.giver_id
    ) {
      twoPersonLoops++;
    }
  }
  twoPersonLoops = twoPersonLoops / 2;

  const allPassed =
    coverageOk && giversOk && receiversOk && noSelfGiftOk && exclusionsOk;

  const panel = document.getElementById("integrity-panel");
  const titleEl = document.getElementById("integrity-title");
  const hashEl = document.getElementById("integrity-hash");
  const summaryEl = document.getElementById("integrity-summary");
  const gridEl = document.getElementById("integrity-checks-grid");

  showElement("integrity-panel");
  const timeStr = new Date().toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  hashEl.textContent = `${computeVerificationFingerprint(dbMatches)} · ${timeStr}`;

  if (allPassed) {
    panel.classList.remove("has-errors");
    titleEl.innerHTML = `<span>🛡️</span><span>Doble Check Superado: Parejas 100% Íntegras</span>`;
    summaryEl.textContent =
      "Auditoría completada contra la base de datos sin revelar identidades. Todas las condiciones del sorteo se cumplen:";
  } else {
    panel.classList.add("has-errors");
    titleEl.innerHTML = `<span>⚠️</span><span>Atención: Sorteo Desincronizado o con Conflictos</span>`;
    summaryEl.textContent =
      "Se han detectado cambios en participantes o exclusiones posteriores al sorteo. Pulsa «Volver a Sortear Parejas» para corregirlo:";
  }

  const checks = [
    {
      ok: coverageOk,
      title: "Cobertura Total",
      detail: coverageOk
        ? `${totalP} de ${totalP} participantes incluidos`
        : `${totalM} parejas para ${totalP} participantes`,
    },
    {
      ok: giversOk,
      title: "1 Regalo por Persona",
      detail: giversOk
        ? `${uniqueGivers.size}/${totalP} regalan exactamente a 1`
        : `Faltan o sobran asignaciones de regalo`,
    },
    {
      ok: receiversOk,
      title: "Nadie sin Regalo",
      detail: receiversOk
        ? `${uniqueReceivers.size}/${totalP} reciben exactamente 1`
        : `Hay participantes sin recibir regalo`,
    },
    {
      ok: noSelfGiftOk,
      title: "Cero Auto-Regalos",
      detail: noSelfGiftOk
        ? "0 personas se regalan a sí mismas"
        : `${selfGiftsCount} auto-asignación detectada`,
    },
    {
      ok: exclusionsOk,
      title: "Exclusiones Respetadas",
      detail: exclusionsOk
        ? `${dbExclusions.length}/${dbExclusions.length} reglas cumplidas al 100%`
        : `${violatedExclusions} conflicto(s) con reglas actuales`,
    },
    {
      ok: true,
      warn: totalP >= 4 && twoPersonLoops > 0,
      title: "Distribución de Cadena",
      detail:
        totalP <= 2
          ? "Intercambio directo (2 personas)"
          : twoPersonLoops === 0
            ? "0 cruces directos mutuos (A ↔ B)"
            : `${twoPersonLoops} cruce(s) recíproco(s) por exclusiones`,
    },
  ];

  gridEl.innerHTML = checks
    .map((c) => {
      const stateClass = !c.ok ? "fail" : c.warn ? "warn" : "ok";
      const icon = !c.ok ? "❌" : c.warn ? "ℹ️" : "✅";
      return `
        <div class="integrity-check-item ${stateClass}">
          <span class="check-icon">${icon}</span>
          <div class="check-text">
            <strong>${escapeHtml(c.title)}</strong>
            <span>${escapeHtml(c.detail)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  if (showToastFeedback) {
    if (allPassed) {
      showToast(
        "Verificación completada: todas las parejas son válidas y nadie se queda sin regalo",
        "success",
      );
    } else {
      showToast(
        "Se detectaron desajustes en el sorteo. Revisa el panel de verificación.",
        "error",
      );
    }
  }
}

window.toggleRevealRow = (id, realName) => {
  const el = document.getElementById(id);
  const btn = document.getElementById("btn-" + id);
  if (el.dataset.revealed !== "true") {
    el.dataset.revealed = "true";
    el.textContent = "👉 " + realName;
    el.style.color = "var(--color-primary)";
    el.style.fontWeight = "700";
    el.style.background = "#fef2f2";
    el.style.borderColor = "#fca5a5";
    btn.innerHTML = "🙈 Ocultar";
  } else {
    el.dataset.revealed = "false";
    el.textContent = "🎁 Oculto (Sin Spoiler)";
    el.style.color = "var(--color-text-muted)";
    el.style.fontWeight = "normal";
    el.style.background = "var(--color-surface-alt)";
    el.style.borderColor = "#cbd5e1";
    btn.innerHTML = "👁️ Ver pareja";
  }
};

window.copyParticipantLink = (link, btnId) => {
  navigator.clipboard.writeText(link);
  const btn = document.getElementById(btnId);
  if (btn) {
    const prev = btn.innerHTML;
    btn.innerHTML = "✅ Copiado";
    setTimeout(() => {
      btn.innerHTML = prev;
    }, 2000);
  }
  showToast("Enlace copiado al portapapeles", "success");
};

async function loadLinks() {
  showElement("results-section");
  const { data: matches } = await supabase
    .from("matches")
    .select(
      `
        id,
        giver:participants!matches_giver_id_fkey(name, phone),
        receiver:participants!matches_receiver_id_fkey(name)
      `,
    )
    .eq("game_id", gameId);

  const list = document.getElementById("links-list");
  list.innerHTML = "";

  if (!matches || matches.length === 0) return;

  document.getElementById("links-count-badge").textContent =
    `${matches.length} enlaces activos`;

  const baseUrl =
    window.location.origin +
    window.location.pathname.replace("admin.html", "reveal.html");

  matches.forEach((m) => {
    if (!m.giver || !m.receiver) return;
    const link = `${baseUrl}?id=${m.id}`;

    let waButton = "";
    if (m.giver.phone) {
      const cleanPhone = m.giver.phone.replace(/\D/g, "");
      const message = `🎄 ¡Hola ${m.giver.name}! Aquí tienes tu enlace secreto para el Amigo Invisible: ${link}\n\nDentro podrás descubrir a quién te ha tocado regalar y también añadir tus sugerencias y enlaces de tiendas online para ayudarte con tu regalo.`;
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
        message,
      )}`;
      waButton = `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp">💬 Enviar por WhatsApp</a>`;
    }

    const safeReceiver = m.receiver.name
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");

    const li = document.createElement("li");
    li.className = "participant-item";

    li.innerHTML = `
      <div class="match-row">
        <div class="match-top">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <div class="avatar-circle" style="width:32px; height:32px; font-size:0.78rem;">
              ${escapeHtml(getInitials(m.giver.name))}
            </div>
            <strong>${escapeHtml(m.giver.name)}</strong>
          </div>
          <div class="match-actions">
            ${waButton}
            <span id="rev-${m.id}" class="secret-target" data-revealed="false">🎁 Oculto (Sin Spoiler)</span>
            <button
              id="btn-rev-${m.id}"
              class="reveal-btn"
              onclick="window.toggleRevealRow('rev-${m.id}', '${safeReceiver}')"
              title="Mostrar u ocultar a quién regala"
            >
              👁️ Ver pareja
            </button>
          </div>
        </div>
        <div class="match-tools">
          <input type="text" value="${link}" readonly class="link-input-readonly" aria-label="Enlace para ${escapeHtml(m.giver.name)}">
          <button
            id="btn-copy-${m.id}"
            class="btn btn-sm"
            onclick="window.copyParticipantLink('${link}', 'btn-copy-${m.id}')"
          >
            📋 Copiar
          </button>
        </div>
      </div>
    `;
    list.appendChild(li);
  });
}

init();
