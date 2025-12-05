import { supabase } from "./supabase-client.js";
import { getUrlParam, hideElement, showElement, showToast } from "./utils.js";

const matchId = getUrlParam("id");
if (!matchId) {
  document.body.innerHTML =
    '<h1 style="color:white; text-align:center; margin-top:50px;">Enlace Inválido</h1>';
}

let giverId = null;

async function init() {
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

  if (error || !match) {
    document.body.innerHTML =
      '<h1 style="color:white; text-align:center;">El enlace ha expirado o no existe</h1>';
    return;
  }

  showElement("content");

  giverId = match.giver.id;
  document.getElementById("greeting").innerText = `¡Hola, ${match.giver.name}!`;
  document.getElementById("target-name").innerText = match.receiver.name;
  document.getElementById("my-wishes").value = match.giver.suggestions || "";

  if (match.receiver.suggestions) {
    showElement("target-wishes");
    document.getElementById("target-wish-text").innerText =
      match.receiver.suggestions;
  }
}

document.getElementById("reveal-box").addEventListener("click", function () {
  this.classList.toggle("reveal-active");
});

document
  .getElementById("wishlist-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const suggestions = document.getElementById("my-wishes").value;

    const { error } = await supabase
      .from("participants")
      .update({ suggestions })
      .eq("id", giverId);

    if (!error) {
      showToast("¡Sugerencias guardadas!");
    } else {
      showToast("Error al guardar");
    }
  });

init();
