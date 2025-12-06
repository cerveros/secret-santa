import { supabase } from "./supabase-client.js";
import { generateUUID, getUrlParam, showElement, showToast } from "./utils.js";

const gameId = getUrlParam("id");
if (!gameId) window.location.href = "index.html";

let participants = [];
let exclusions = [];

async function init() {
  const { data: game, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();

  if (error) {
    alert("Game not found");
    window.location.href = "index.html";
    return;
  }

  document.getElementById("game-info").innerHTML = `
        <strong>Group:</strong> ${game.name}<br>
        <small>ID: ${game.id}</small>
    `;

  if (game.is_drawn) {
    document.getElementById("btn-draw").innerText = "🔄 Re-Draw Matches";
    document.getElementById("draw-status").innerText = "Matches active.";
    await loadLinks();
  }

  await loadParticipants();
  await loadExclusions();
}

async function loadParticipants() {
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });

  if (data) {
    participants = data;
    renderParticipants();
    updateSelects();
  }
}

async function loadExclusions() {
  const { data, error } = await supabase
    .from("exclusions")
    .select("*")
    .eq("game_id", gameId);

  if (data) {
    exclusions = data;
    renderExclusions();
  }
}

function renderParticipants() {
  const list = document.getElementById("participants-list");
  list.innerHTML = "";
  participants.forEach((p) => {
    const li = document.createElement("li");
    li.className = "participant-item";
    li.id = `row-${p.id}`; // Add ID for easier DOM manipulation

    const phoneDisplay = p.phone
      ? `<br><small style="color:#666">📞 ${p.phone}</small>`
      : "";

    li.innerHTML = `
            <div style="flex-grow: 1;">
                <span id="name-${p.id}" style="font-weight:bold;">${p.name}</span>
                ${phoneDisplay}
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="btn-icon" onclick="window.editP('${p.id}')" title="Edit">✏️</button>
                <button class="btn-icon" style="color:#c53030;" onclick="window.removeP('${p.id}')" title="Remove">🗑️</button>
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

  participants.forEach((p) => {
    from.add(new Option(p.name, p.id));
    to.add(new Option(p.name, p.id));
  });
}

function renderExclusions() {
  const list = document.getElementById("exclusions-list");
  list.innerHTML = "";
  exclusions.forEach((ex) => {
    const p1 =
      participants.find((p) => p.id === ex.participant_id)?.name || "Unknown";
    const p2 =
      participants.find((p) => p.id === ex.excluded_participant_id)?.name ||
      "Unknown";

    const li = document.createElement("li");
    li.className = "participant-item";
    li.innerHTML = `
            <small>${p1} ↔ ${p2}</small>
            <button class="btn btn-danger" onclick="window.removeEx('${ex.id}')">X</button>
        `;
    list.appendChild(li);
  });
}

// Inline Edit Logic
window.editP = (id) => {
  const p = participants.find((part) => part.id === id);
  if (!p) return;

  const row = document.getElementById(`row-${id}`);
  const originalHTML = row.innerHTML; // Save just in case but we use re-render mostly

  row.innerHTML = `
        <div class="edit-row">
            <input type="text" id="edit-name-${id}" class="edit-input" value="${
    p.name
  }" placeholder="Name">
            <input type="tel" id="edit-phone-${id}" class="edit-input" value="${
    p.phone || ""
  }" placeholder="Phone">
        </div>
        <div style="display: flex; gap: 5px;">
            <button class="btn-icon" style="color:var(--color-secondary);" onclick="window.saveP('${id}')" title="Save">✅</button>
            <button class="btn-icon" style="color:gray;" onclick="window.cancelP('${id}')" title="Cancel">❌</button>
        </div>
    `;
};

window.cancelP = (id) => {
  // Just re-render the whole list to restore state (fast enough)
  renderParticipants();
};

window.saveP = async (id) => {
  const newName = document.getElementById(`edit-name-${id}`).value;
  const newPhone = document.getElementById(`edit-phone-${id}`).value;

  if (!newName) return showToast("Name is required");

  const { error } = await supabase
    .from("participants")
    .update({ name: newName, phone: newPhone })
    .eq("id", id);

  if (error) {
    showToast("Error updating: " + error.message);
  } else {
    showToast("Updated successfully");
    loadParticipants(); // Reload data to reflect changes everywhere
  }
};

document
  .getElementById("add-participant-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("p-name").value;
    const phone = document.getElementById("p-phone").value;

    const { error } = await supabase
      .from("participants")
      .insert([{ game_id: gameId, name, phone }]);

    if (!error) {
      document.getElementById("p-name").value = "";
      document.getElementById("p-phone").value = "";
      loadParticipants();
      showToast("Participant added");
    } else {
      showToast("Error adding participant");
    }
  });

document.getElementById("btn-bulk-add").addEventListener("click", async () => {
  const text = document.getElementById("p-bulk-names").value;
  if (!text) return;

  const names = text
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (names.length === 0) return showToast("No valid names found");

  const toInsert = names.map((name) => ({
    game_id: gameId,
    name: name,
  }));

  const { error } = await supabase.from("participants").insert(toInsert);

  if (!error) {
    document.getElementById("p-bulk-names").value = "";
    loadParticipants();
    showToast(`Added ${names.length} participants`);
  } else {
    showToast("Error importing list");
  }
});

document
  .getElementById("btn-add-exclusion")
  .addEventListener("click", async () => {
    const pId = document.getElementById("excl-from").value;
    const exId = document.getElementById("excl-to").value;

    if (pId === exId) return showToast("Cannot exclude self");

    const { error } = await supabase
      .from("exclusions")
      .insert([
        { game_id: gameId, participant_id: pId, excluded_participant_id: exId },
      ]);

    if (!error) {
      loadExclusions();
    }
  });

window.removeP = async (id) => {
  if (!confirm("Delete participant?")) return;
  await supabase.from("participants").delete().eq("id", id);
  loadParticipants();
};

window.removeEx = async (id) => {
  await supabase.from("exclusions").delete().eq("id", id);
  loadExclusions();
};

document.getElementById("btn-draw").addEventListener("click", async () => {
  if (participants.length < 2) return showToast("Need at least 2 participants");
  if (
    !confirm(
      "WARNING: If you re-draw, ALL previous links sent to participants will stop working. Create new matches?",
    )
  )
    return;

  await supabase.from("matches").delete().eq("game_id", gameId);

  const matches = generateSecretSanta(participants, exclusions);

  if (!matches)
    return showToast(
      "Could not generate valid matches with current exclusions.",
    );

  const insertData = matches.map((m) => ({
    id: generateUUID(),
    game_id: gameId,
    giver_id: m.giver,
    receiver_id: m.receiver,
  }));

  const { error } = await supabase.from("matches").insert(insertData);

  if (!error) {
    await supabase.from("games").update({ is_drawn: true }).eq("id", gameId);
    document.getElementById("btn-draw").innerText = "🔄 Re-Draw Matches";
    showToast("Matches generated!");
    await loadLinks();
  } else {
    showToast("Error saving matches: " + error.message);
  }
});

function generateSecretSanta(people, rules) {
  let pool = [...people];
  let result = [];

  for (let attempt = 0; attempt < 100; attempt++) {
    let receivers = [...people];
    result = [];
    let valid = true;

    for (let giver of pool) {
      let options = receivers.filter(
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

      let choiceIndex = Math.floor(Math.random() * options.length);
      let receiver = options[choiceIndex];

      result.push({ giver: giver.id, receiver: receiver.id });
      receivers = receivers.filter((r) => r.id !== receiver.id);
    }

    if (valid) return result;
  }
  return null;
}

window.toggleRevealRow = (id, realName) => {
  const el = document.getElementById(id);
  const btn = document.getElementById("btn-" + id);
  if (el.innerText === "🎁 ???") {
    el.innerText = "👉 " + realName;
    el.style.color = "var(--color-primary)";
    el.style.fontWeight = "bold";
    btn.innerText = "🙈";
  } else {
    el.innerText = "🎁 ???";
    el.style.color = "#666";
    el.style.fontWeight = "normal";
    btn.innerText = "👁️";
  }
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

  const baseUrl =
    window.location.origin +
    window.location.pathname.replace("admin.html", "reveal.html");

  matches.forEach((m) => {
    const link = `${baseUrl}?id=${m.id}`;

    let waButton = "";
    if (m.giver.phone) {
      const cleanPhone = m.giver.phone.replace(/\D/g, ""); // Remove non-numbers
      const message = `🎄 Hola ${m.giver.name}, aquí tienes tu enlace para el Amigo Invisible: ${link}, puedes añadir sugerencias para que te regalen, y recuerda revisar este enlace por si tu amigo invisible añade alguna sugerencia.`;
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
        message,
      )}`;
      waButton = `<a href="${waUrl}" target="_blank" class="btn-whatsapp">WhatsApp</a>`;
    }

    const li = document.createElement("li");
    li.className = "participant-item";

    li.innerHTML = `
            <div class="match-row">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${m.giver.name}</strong>
                    ${waButton}
                </div>
                <div class="match-tools">
                    <span id="rev-${m.id}" class="secret-target">🎁 ???</span>
                    <button id="btn-rev-${
                      m.id
                    }" class="reveal-btn" onclick="window.toggleRevealRow('rev-${
      m.id
    }', '${m.receiver.name.replace(
      /'/g,
      "\\'",
    )}')" title="Reveal target">👁️</button>
                </div>
                <div class="match-tools">
                    <input type="text" value="${link}" readonly style="font-size:0.8rem; padding:0.2rem; flex-grow:1;">
                    <button class="btn" style="width:auto; padding:0.2rem 0.5rem;" onclick="navigator.clipboard.writeText('${link}')">Copy</button>
                </div>
            </div>
        `;
    list.appendChild(li);
  });
}

init();
