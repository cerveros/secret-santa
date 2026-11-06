import { supabase } from "./supabase-client.js";
import { escapeHtml, showToast } from "./utils.js";

export const SYSTEM_CONFIG_NAME = "__SYSTEM_ADMIN_CONFIG__";
// Precomputed salted SHA-256 for default password "tomate314"
export const DEFAULT_MASTER_HASH =
  "sha256:ss_v1_9f8e7d6c5b4a:0b06367a3d763336075ac7e06bce8929b5b08fd955dbff9f0f5c51a64ea458f2";
const LOCAL_AUTH_KEY = "ss_master_auth_hash";

/**
 * Pure-JS + WebCrypto SHA-256 implementation (works on both HTTPS/localhost and LAN HTTP)
 */
export async function sha256Hex(message) {
  if (window.crypto && window.crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(message);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback to pure JS below
    }
  }
  return sha256Fallback(message);
}

function sha256Fallback(asciiStr) {
  const utf8 = unescape(encodeURIComponent(asciiStr));
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const l = utf8.length * 8;
  const words = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= (utf8.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }
  words[l >> 5] |= 0x80 << (24 - (l % 32));
  words[(((l + 64) >> 9) << 4) + 15] = l;

  const W = new Array(64);
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < words.length; i += 16) {
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      if (t < 16) {
        W[t] = words[i + t] | 0;
      } else {
        const g0 =
          rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
        const g1 =
          rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + g0 + W[t - 7] + g1) | 0;
      }
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[t] + W[t]) | 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  return H.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

export async function createSaltedHash(plainPassword) {
  const randomSalt =
    "ss_v1_" +
    Math.random().toString(16).slice(2, 8) +
    Date.now().toString(16).slice(-6);
  const digest = await sha256Hex(`${randomSalt}:${plainPassword}`);
  return `sha256:${randomSalt}:${digest}`;
}

export async function verifySaltedHash(plainPassword, storedHashString) {
  if (!storedHashString || !plainPassword) return false;
  if (storedHashString.startsWith("sha256:")) {
    const parts = storedHashString.split(":");
    if (parts.length === 3) {
      const salt = parts[1];
      const expectedDigest = parts[2];
      const actualDigest = await sha256Hex(`${salt}:${plainPassword}`);
      return actualDigest === expectedDigest;
    }
  }
  return false;
}

/**
 * Fetches the global system admin config from Supabase,
 * or initializes it with the encrypted default ("tomate314") if not present yet.
 */
export async function getOrInitSystemConfig() {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("name", SYSTEM_CONFIG_NAME)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!error && data && data.length > 0) {
    return data[0];
  }

  const { data: created, error: insertError } = await supabase
    .from("games")
    .insert([
      {
        name: SYSTEM_CONFIG_NAME,
        admin_password: DEFAULT_MASTER_HASH,
        is_drawn: false,
      },
    ])
    .select()
    .single();

  if (insertError) {
    console.error("Error initializing system config:", insertError);
    return { id: null, name: SYSTEM_CONFIG_NAME, admin_password: DEFAULT_MASTER_HASH };
  }

  return created;
}

/**
 * Blocks the entire administration UI until the master password is validated against Supabase.
 */
export async function requireAdminAuth() {
  const mainContainer = document.querySelector(".container");
  if (mainContainer) {
    mainContainer.classList.add("hidden");
  }

  const config = await getOrInitSystemConfig();
  const savedHash = localStorage.getItem(LOCAL_AUTH_KEY);

  if (savedHash && savedHash === config.admin_password) {
    if (mainContainer) {
      mainContainer.classList.remove("hidden");
    }
    return config;
  }

  return new Promise((resolve) => {
    let gate = document.getElementById("admin-auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "admin-auth-gate";
      gate.className = "container";
      gate.style.maxWidth = "460px";
      document.body.appendChild(gate);
    }

    gate.innerHTML = `
      <div class="hero-header" style="margin-bottom: 1.5rem;">
        <span class="hero-badge">🔒 Zona de Administración Protegida</span>
        <h1 style="font-size: 1.9rem;">Acceso Administrador</h1>
        <p class="subtitle" style="font-size: 0.9rem;">
          Introduce la contraseña maestra para acceder a la gestión de grupos y sorteos.
        </p>
      </div>
      <form id="master-auth-form" class="section-card" style="margin-bottom: 0;">
        <div class="form-group">
          <label for="master-auth-password">Contraseña de Administración</label>
          <input
            type="password"
            id="master-auth-password"
            placeholder="Introduce la contraseña..."
            required
            autocomplete="current-password"
          />
        </div>
        <button type="submit" id="btn-master-auth" class="btn">
          🔓 Desbloquear Administración
        </button>
      </form>
    `;

    const inputEl = document.getElementById("master-auth-password");
    setTimeout(() => inputEl?.focus(), 50);

    document
      .getElementById("master-auth-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("btn-master-auth");
        const pwd = inputEl.value;
        btn.disabled = true;
        btn.textContent = "Verificando...";

        const latestConfig = await getOrInitSystemConfig();
        const isValid = await verifySaltedHash(pwd, latestConfig.admin_password);

        if (isValid) {
          localStorage.setItem(LOCAL_AUTH_KEY, latestConfig.admin_password);
          gate.remove();
          if (mainContainer) {
            mainContainer.classList.remove("hidden");
          }
          showToast("Acceso de administrador verificado ✨", "success");
          resolve(latestConfig);
        } else {
          btn.disabled = false;
          btn.textContent = "🔓 Desbloquear Administración";
          inputEl.value = "";
          inputEl.focus();
          showToast("Contraseña incorrecta. Inténtalo de nuevo.", "error");
        }
      });
  });
}

export function logoutAdmin() {
  localStorage.removeItem(LOCAL_AUTH_KEY);
  window.location.href = "index.html";
}

/**
 * Opens a modal to change the master admin password (requires validating the current one first).
 */
export function openChangePasswordModal() {
  let modal = document.getElementById("change-pwd-modal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.id = "change-pwd-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal-card">
      <div class="section-header" style="margin-bottom: 0.75rem;">
        <h3>🔑 Cambiar Contraseña de Administración</h3>
        <button type="button" id="btn-close-pwd-modal" class="btn-icon" title="Cerrar">✕</button>
      </div>
      <p style="font-size: 0.86rem; color: var(--color-text-muted); margin-bottom: 1rem;">
        La nueva contraseña se guardará encriptada (SHA-256 con sal criptográfica) en Supabase.
      </p>
      <form id="change-pwd-form">
        <div class="form-group">
          <label for="current-master-pwd">Contraseña actual</label>
          <input type="password" id="current-master-pwd" required placeholder="Tu contraseña actual" />
        </div>
        <div class="form-group">
          <label for="new-master-pwd">Nueva contraseña</label>
          <input type="password" id="new-master-pwd" required minlength="4" placeholder="Mínimo 4 caracteres" />
        </div>
        <div class="form-group">
          <label for="confirm-master-pwd">Confirmar nueva contraseña</label>
          <input type="password" id="confirm-master-pwd" required minlength="4" placeholder="Repite la nueva contraseña" />
        </div>
        <div style="display: flex; gap: 0.6rem; margin-top: 1.25rem;">
          <button type="submit" id="btn-save-new-pwd" class="btn">💾 Actualizar Contraseña</button>
          <button type="button" id="btn-cancel-pwd-modal" class="btn btn-outline" style="margin-top:0;">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.getElementById("btn-close-pwd-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-pwd-modal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.getElementById("change-pwd-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPwd = document.getElementById("current-master-pwd").value;
    const newPwd = document.getElementById("new-master-pwd").value;
    const confirmPwd = document.getElementById("confirm-master-pwd").value;

    if (newPwd !== confirmPwd) {
      return showToast("La nueva contraseña y su confirmación no coinciden", "warning");
    }

    const saveBtn = document.getElementById("btn-save-new-pwd");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";

    const config = await getOrInitSystemConfig();
    const isCurrentValid = await verifySaltedHash(currentPwd, config.admin_password);

    if (!isCurrentValid) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Actualizar Contraseña";
      return showToast("La contraseña actual no es correcta", "error");
    }

    const newEncryptedHash = await createSaltedHash(newPwd);
    const { error } = await supabase
      .from("games")
      .update({ admin_password: newEncryptedHash })
      .eq("id", config.id);

    if (error) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Actualizar Contraseña";
      return showToast("Error al guardar en Supabase: " + error.message, "error");
    }

    localStorage.setItem(LOCAL_AUTH_KEY, newEncryptedHash);
    showToast("¡Contraseña de administración actualizada y encriptada!", "success");
    closeModal();
  });
}

/**
 * HUMAN-READABLE GROUP CODES HELPERS
 */
export function slugifyGroupCode(text) {
  if (!text) return "";
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

export function getGroupCode(game) {
  if (!game) return "";
  const rawField = game.admin_password || "";
  if (rawField.startsWith("CODE:")) {
    return rawField.slice(5);
  }
  const fromName = slugifyGroupCode(game.name);
  if (fromName) return fromName;
  return "GRUPO-" + String(game.id || "").slice(0, 4).toUpperCase();
}

export function formatCodeForStorage(code) {
  return `CODE:${slugifyGroupCode(code)}`;
}

export async function fetchAllGroups() {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .neq("name", SYSTEM_CONFIG_NAME)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((g) => ({
    ...g,
    code: getGroupCode(g),
  }));
}

export async function findGroupByCodeOrIdentifier(identifier) {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  const normalizedCode = slugifyGroupCode(trimmed);
  const allGroups = await fetchAllGroups();

  // 1. Exact match by human code
  let found = allGroups.find(
    (g) => g.code.toUpperCase() === trimmed.toUpperCase() || g.code === normalizedCode,
  );
  if (found) return found;

  // 2. Match by group name (case-insensitive)
  found = allGroups.find(
    (g) => g.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (found) return found;

  // 3. Fallback match by UUID
  found = allGroups.find((g) => g.id.toLowerCase() === trimmed.toLowerCase());
  return found || null;
}

/**
 * Copies or imports participants (names + phones) and exclusions
 * from sourceGameId into targetGameId. Wishes/suggestions are never copied
 * so each year/group starts with fresh wishlists.
 */
export async function copyGroupData({
  sourceGameId,
  targetGameId,
  importParticipants = true,
  importExclusions = true,
}) {
  const [srcPRes, srcExRes, tgtPRes, tgtExRes] = await Promise.all([
    supabase
      .from("participants")
      .select("*")
      .eq("game_id", sourceGameId)
      .order("created_at", { ascending: true }),
    supabase.from("exclusions").select("*").eq("game_id", sourceGameId),
    supabase.from("participants").select("*").eq("game_id", targetGameId),
    supabase.from("exclusions").select("*").eq("game_id", targetGameId),
  ]);

  const srcParticipants = srcPRes.data || [];
  const srcExclusions = srcExRes.data || [];
  let tgtParticipants = tgtPRes.data || [];
  const tgtExclusions = tgtExRes.data || [];

  const normalizeName = (n) => (n || "").trim().toLowerCase();

  let addedParticipantsCount = 0;
  let addedExclusionsCount = 0;

  // 1. Add missing participants (names + phones only, without wishes)
  if (importParticipants) {
    const existingNames = new Set(
      tgtParticipants.map((p) => normalizeName(p.name)),
    );
    const toInsert = [];

    for (const sp of srcParticipants) {
      const key = normalizeName(sp.name);
      if (key && !existingNames.has(key)) {
        existingNames.add(key);
        toInsert.push({
          game_id: targetGameId,
          name: sp.name.trim(),
          phone: sp.phone || "",
          suggestions: "",
        });
      }
    }

    if (toInsert.length > 0) {
      const { data: inserted } = await supabase
        .from("participants")
        .insert(toInsert)
        .select();
      if (inserted) {
        addedParticipantsCount = inserted.length;
        tgtParticipants = [...tgtParticipants, ...inserted];
      }
    }
  }

  // 2. Import exclusion rules mapped by participant name
  if (importExclusions && srcExclusions.length > 0) {
    const srcIdToName = new Map(
      srcParticipants.map((p) => [p.id, normalizeName(p.name)]),
    );
    const tgtNameToId = new Map(
      tgtParticipants.map((p) => [normalizeName(p.name), p.id]),
    );

    const exclusionsToInsert = [];

    for (const ex of srcExclusions) {
      const nameA = srcIdToName.get(ex.participant_id);
      const nameB = srcIdToName.get(ex.excluded_participant_id);
      if (!nameA || !nameB) continue;

      const tgtIdA = tgtNameToId.get(nameA);
      const tgtIdB = tgtNameToId.get(nameB);
      if (!tgtIdA || !tgtIdB || tgtIdA === tgtIdB) continue;

      const alreadyInTarget =
        tgtExclusions.some(
          (te) =>
            (te.participant_id === tgtIdA &&
              te.excluded_participant_id === tgtIdB) ||
            (te.participant_id === tgtIdB &&
              te.excluded_participant_id === tgtIdA),
        ) ||
        exclusionsToInsert.some(
          (te) =>
            (te.participant_id === tgtIdA &&
              te.excluded_participant_id === tgtIdB) ||
            (te.participant_id === tgtIdB &&
              te.excluded_participant_id === tgtIdA),
        );

      if (!alreadyInTarget) {
        exclusionsToInsert.push({
          game_id: targetGameId,
          participant_id: tgtIdA,
          excluded_participant_id: tgtIdB,
        });
      }
    }

    if (exclusionsToInsert.length > 0) {
      const { data: insertedEx } = await supabase
        .from("exclusions")
        .insert(exclusionsToInsert)
        .select();
      if (insertedEx) {
        addedExclusionsCount = insertedEx.length;
      }
    }
  }

  return {
    addedParticipantsCount,
    addedExclusionsCount,
  };
}

/**
 * Deletes a group and all its related matches, exclusions, and participants from Supabase.
 */
export async function deleteGroupCompletely(targetGameId) {
  await supabase.from("matches").delete().eq("game_id", targetGameId);
  await supabase.from("exclusions").delete().eq("game_id", targetGameId);
  await supabase.from("participants").delete().eq("game_id", targetGameId);
  const { error } = await supabase
    .from("games")
    .delete()
    .eq("id", targetGameId);
  return { error };
}

/**
 * Opens a confirmation modal to permanently delete a group.
 */
export function openDeleteGroupModal(game, onDeleted) {
  if (!game) return;
  const code = game.code || getGroupCode(game);

  let modal = document.getElementById("delete-group-modal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.id = "delete-group-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal-card" style="border-top: 5px solid var(--color-danger);">
      <div class="section-header" style="margin-bottom: 0.75rem;">
        <h3 style="color: var(--color-danger);">🗑️ Eliminar Grupo</h3>
        <button type="button" id="btn-close-del-modal" class="btn-icon" title="Cerrar">✕</button>
      </div>
      <p style="font-size: 0.92rem; color: var(--color-text); margin-bottom: 0.75rem;">
        ¿Estás seguro de que quieres eliminar permanentemente el grupo
        <strong>«${escapeHtml(game.name)}»</strong>
        (<span class="code-badge" style="font-size:0.75rem;">🏷️ ${escapeHtml(code)}</span>)?
      </p>
      <div
        style="
          background: var(--color-danger-bg);
          border: 1px solid var(--color-danger-border);
          color: var(--color-primary-dark);
          padding: 0.75rem 0.9rem;
          border-radius: 10px;
          font-size: 0.82rem;
          margin-bottom: 1.25rem;
        "
      >
        ⚠️ <strong>Esta acción no se puede deshacer:</strong> se borrarán todos sus participantes, exclusiones, sugerencias de regalo y enlaces generados.
      </div>
      <div style="display: flex; gap: 0.6rem;">
        <button
          type="button"
          id="btn-confirm-delete-group"
          class="btn btn-primary-red"
        >
          🗑️ Sí, Eliminar Definitivamente
        </button>
        <button
          type="button"
          id="btn-cancel-del-modal"
          class="btn btn-outline"
          style="margin-top: 0;"
        >
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.getElementById("btn-close-del-modal").onclick = closeModal;
  document.getElementById("btn-cancel-del-modal").onclick = closeModal;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document
    .getElementById("btn-confirm-delete-group")
    .addEventListener("click", async () => {
      const btn = document.getElementById("btn-confirm-delete-group");
      btn.disabled = true;
      btn.textContent = "Eliminando...";

      const { error } = await deleteGroupCompletely(game.id);
      if (error) {
        btn.disabled = false;
        btn.textContent = "🗑️ Sí, Eliminar Definitivamente";
        return showToast("Error al eliminar el grupo: " + error.message, "error");
      }

      if (localStorage.getItem("admin_game_id") === game.id) {
        localStorage.removeItem("admin_game_id");
      }

      closeModal();
      showToast(`Grupo «${game.name}» eliminado correctamente`, "success");
      if (typeof onDeleted === "function") {
        onDeleted();
      }
    });
}

