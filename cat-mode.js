// Cat mode: drifting paw prints and a blinking cat link, remembered on this device.
// Moved out of app.js unchanged (cleanup plan, step 1).

// ---------- Cat link ----------
export function ensureCatLinkMarkup() {
  const a = document.querySelector(".catlink");
  if (!a) return;
  if (!a.id) a.id = "catLink";

  if (a.querySelector(".catlink-inner")) return;

  a.innerHTML = `
    <span class="catlink-inner" aria-hidden="true">
      <span class="cat-face">🐈‍⬛</span>
      <span class="cat-tail">〰️</span>
    </span>
  `;
}

function setCatFaceEmoji(emoji) {
  const face = document.querySelector("#catLink .cat-face");
  if (face) face.textContent = emoji;
}

// ---------- Cat mode ----------
export const LS_CATMODE = "huberts_house_catmode_v1";
let pawsTimer = null;
let blinkTimer = null;

const catLayer = document.getElementById("catLayer");

export function setCatMode(on) {
  document.documentElement.classList.toggle("cat-mode", !!on);
  localStorage.setItem(LS_CATMODE, on ? "1" : "0");
  if (catLayer) catLayer.classList.toggle("hidden", !on);

  if (on) {
    startCatAmbient();
    startBlinking();
    setCatFaceEmoji("😼");
  } else {
    stopCatAmbient();
    stopBlinking();
    setCatFaceEmoji("🐈‍⬛");
  }
}

document.getElementById("catModeBtn")?.addEventListener("click", () => {
  const on = !document.documentElement.classList.contains("cat-mode");
  setCatMode(on);
});

function startCatAmbient() {
  if (!catLayer) return;
  catLayer.classList.remove("hidden");
  catLayer.innerHTML = "";

  const makePaw = () => {
    const paw = document.createElement("div");
    paw.textContent = "🐾";
    paw.style.position = "absolute";
    paw.style.left = Math.round(Math.random() * 92) + "%";
    paw.style.top = "110%";
    paw.style.fontSize = (12 + Math.random() * 18).toFixed(0) + "px";
    paw.style.opacity = (0.10 + Math.random() * 0.20).toFixed(2);
    paw.style.transform = `rotate(${Math.round(Math.random() * 40 - 20)}deg)`;
    paw.style.transition = "top 6.5s linear, opacity 6.5s linear";
    catLayer.appendChild(paw);

    requestAnimationFrame(() => {
      paw.style.top = "-10%";
      paw.style.opacity = "0";
    });

    setTimeout(() => paw.remove(), 7000);
  };

  if (pawsTimer) clearInterval(pawsTimer);
  pawsTimer = setInterval(() => {
    if (!document.documentElement.classList.contains("cat-mode")) return;
    makePaw();
  }, 900);
}

function stopCatAmbient() {
  if (pawsTimer) clearInterval(pawsTimer);
  pawsTimer = null;
  if (catLayer) catLayer.innerHTML = "";
}

function startBlinking() {
  stopBlinking();
  const schedule = () => {
    const delay = 4500 + Math.random() * 6500;
    blinkTimer = setTimeout(() => {
      if (!document.documentElement.classList.contains("cat-mode")) return schedule();
      const el = document.getElementById("catLink");
      if (el) {
        el.classList.add("blink");
        setTimeout(() => el.classList.remove("blink"), 120);
      }
      schedule();
    }, delay);
  };
  schedule();
}

function stopBlinking() {
  if (blinkTimer) clearTimeout(blinkTimer);
  blinkTimer = null;
  const el = document.getElementById("catLink");
  el?.classList.remove("blink");
}
