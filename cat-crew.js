const cats = [
  { name: 'Hubert', coat: '#896448', stripe: '#513b30', eyes: '#edc752', ear: '#654b3d', note: 'Your calendar has been paw-pproved.' },
  { name: 'Mack', coat: '#ad8660', stripe: '#6b4b35', eyes: '#9fc66d', ear: '#947051', note: 'Leave a little room for a play break.' },
  { name: 'Mia', coat: '#dfcfb7', stripe: '#a48d78', eyes: '#8abde0', ear: '#8f7d70', note: 'Today’s outlook: a chance of purrs.' }
];
function portrait(cat) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M20 43 17 12l27 17h13l26-17-3 31" fill="${cat.coat}" stroke="${cat.stripe}" stroke-width="2.5" stroke-linejoin="round"/><path d="m23 23 3 17 12-7m39-10-3 17-12-7" fill="${cat.ear}"/><ellipse cx="50" cy="57" rx="35" ry="31" fill="${cat.coat}"/><path d="m39 29 4 12 7-9 7 9 4-12M17 49l12 5-12 4m66-9-12 5 12 4M20 65l11-3m49 3-11-3" fill="none" stroke="${cat.stripe}" stroke-width="4" stroke-linecap="round"/><ellipse cx="36" cy="56" rx="8" ry="7" fill="${cat.eyes}"/><ellipse cx="64" cy="56" rx="8" ry="7" fill="${cat.eyes}"/><ellipse cx="36" cy="56" rx="2.5" ry="6" fill="#30302c"/><ellipse cx="64" cy="56" rx="2.5" ry="6" fill="#30302c"/><circle cx="38" cy="54" r="1.5" fill="white"/><circle cx="66" cy="54" r="1.5" fill="white"/><ellipse cx="50" cy="72" rx="15" ry="10" fill="#efdfc9" opacity=".7"/><path d="m46 68 4 4 4-4Zm4 4v3m0 0q-5 6-8 1m8-1q5 6 8 1" fill="#76564d" stroke="#76564d" stroke-width="1.5" stroke-linecap="round"/><path d="m28 70-19-3m19 9L9 79m63-9 19-3m-19 9 19 3" stroke="${cat.stripe}" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}
export function initCatCrew() {
  const crew = document.getElementById('catCrew');
  if (!crew) return;
  crew.innerHTML = `<div class="crew-intro"><span class="eyebrow">THE RESIDENT SUPERVISORS</span><p id="crewNote" role="status"></p></div><div class="crew-cats">${cats.map((cat, i) => `<button type="button" data-house-cat="${i}" aria-pressed="false" aria-label="A note from ${cat.name}">${portrait(cat)}<span>${cat.name}</span></button>`).join('')}</div>`;
  const choose = index => {
    crew.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    document.getElementById('crewNote').textContent = `${cats[index].name}: ${cats[index].note}`;
  };
  crew.querySelectorAll('button').forEach(button => button.addEventListener('click', () => choose(Number(button.dataset.houseCat))));
  choose(new Date().getDate() % cats.length);
}
