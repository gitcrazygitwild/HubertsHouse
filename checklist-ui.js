// The editable checklist rows in the event and task windows: draw, add a row, read back.
// DOM helpers that work on the container they're given. Moved out of app.js unchanged.
export function renderChecklistUI(container, items) {
  if (!container) return;
  const safe = Array.isArray(items) ? items : [];
  container.innerHTML = "";
  for (const it of safe) addChecklistItemUI(container, it, false);
}

export function addChecklistItemUI(container, item, focus) {
  if (!container) return;
  const wrap = document.createElement("div");
  wrap.className = "checkitem";
  wrap.dataset.itemId=item.id || crypto.randomUUID();

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!item.done;

  const input = document.createElement("input");
  input.type = "text";
  input.value = item.text || "";
  input.placeholder = "Checklist item…";
  input.maxLength=500;
  input.setAttribute('aria-label','Checklist item');
  cb.setAttribute('aria-label',`Complete ${item.text || 'checklist item'}`);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-ghost";
  del.textContent = "✕";
  del.setAttribute('aria-label','Remove checklist item');
  del.style.width = "44px";
  del.style.padding = "10px 0";

  del.addEventListener("click", () => wrap.remove());

  wrap.appendChild(cb);
  wrap.appendChild(input);
  wrap.appendChild(del);

  container.appendChild(wrap);

  if (focus) input.focus();
}

export function readChecklistUI(container) {
  if (!container) return [];
  const rows = Array.from(container.querySelectorAll(".checkitem"));
  return rows.map((row) => {
    const cb = row.querySelector('input[type="checkbox"]');
    const input = row.querySelector('input[type="text"]');
    return { id:row.dataset.itemId, text: (input?.value || "").trim(), done: !!cb?.checked };
  }).filter(it => it.text.length > 0);
}
