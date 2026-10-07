// The control panel: places to fly to, time of day, month, weather, and the satellite comparison.
import { MONTHS, WEATHER, compass, knots } from '../world/weather.js';

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...children);
  return n;
};
const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/**
 * @param {HTMLElement} root
 * @param {object} app  { env, places, setEnv(patch), flyToPlace(place), setCompare(x|-1), setLabels(bool), attribution[] }
 */
export function buildPanel(root, app) {
  const { env } = app;
  root.hidden = false;
  root.replaceChildren();

  // ---- header and places
  const toggle = el('button', { class: 'panel-toggle', 'aria-label': 'Show or hide the controls', 'aria-expanded': 'true', onclick: () => {
    const open = panel.classList.toggle('collapsed') === false;
    toggle.setAttribute('aria-expanded', String(open));
  } }, el('span', { text: 'Los Roques' }), el('small', { text: 'Venezuela · 11.85° N, 66.75° W' }));
  const places = el('div', { class: 'chips', role: 'group', 'aria-label': 'Fly to a place' },
    ...app.places.map(p => el('button', { class: 'chip', text: p.name, onclick: () => app.flyToPlace(p) })));

  // ---- time of day
  const timeOut = el('output', { text: clock(env.hours) }), sunOut = el('small', { class: 'hint' });
  const time = el('input', { type: 'range', min: '4', max: '21', step: '0.05', value: String(env.hours), 'aria-label': 'Time of day', oninput: () => app.setEnv({ hours: Number(time.value), playing: false }) });
  const play = el('button', { class: 'icon', 'aria-label': 'Play a day', title: 'Play a day', text: '▶', onclick: () => app.setEnv({ playing: !env.playing }) });
  const month = el('select', { 'aria-label': 'Month', onchange: () => app.setEnv({ month: Number(month.value) }) },
    ...MONTHS.map((m, i) => el('option', { value: String(i), text: m })));

  // ---- weather
  const weather = el('div', { class: 'chips', role: 'group', 'aria-label': 'Weather' },
    ...Object.entries(WEATHER).map(([id, w]) => el('button', { class: 'chip', 'data-id': id, text: w.label, onclick: () => app.setEnv({ weather: id, windOverride: null }) })));
  const windOut = el('output');
  const wind = el('input', { type: 'range', min: '0', max: '15', step: '0.5', 'aria-label': 'Wind speed', oninput: () => app.setEnv({ windOverride: Number(wind.value) }) });
  const facts = el('p', { class: 'facts' });

  // ---- view options
  const compare = el('input', { type: 'checkbox', onchange: () => app.setCompare(compare.checked ? 0.5 : -1) });
  const labels = el('input', { type: 'checkbox', checked: '', onchange: () => app.setLabels(labels.checked) });
  const info = el('button', { class: 'link', text: 'About this simulation and its data', onclick: () => dialog.showModal() });

  const panel = el('aside', { class: 'panel' }, toggle,
    el('div', { class: 'panel-body' },
      el('h2', { text: 'Places' }), places,
      el('h2', { text: 'Time' }),
      el('div', { class: 'row' }, play, time, timeOut), sunOut,
      el('label', { class: 'row' }, el('span', { text: 'Month' }), month),
      el('h2', { text: 'Weather' }), weather,
      el('label', { class: 'row' }, el('span', { text: 'Wind' }), wind, windOut), facts,
      el('h2', { text: 'View' }),
      el('label', { class: 'check' }, compare, el('span', { text: 'Compare with the satellite image' })),
      el('label', { class: 'check' }, labels, el('span', { text: 'Place names' })),
      info));

  // ---- satellite comparison divider
  const divider = el('div', { class: 'compare', hidden: '' }, el('span', { class: 'compare-tag left', text: 'Sentinel-2 satellite' }), el('span', { class: 'compare-tag right', text: 'Simulation' }), el('i', { class: 'compare-grip', role: 'slider', 'aria-label': 'Comparison divider', tabindex: '0' }));
  let dragging = false;
  const moveDivider = x => { const f = Math.min(0.97, Math.max(0.03, x / innerWidth)); divider.style.left = `${f * 100}%`; app.setCompare(f); };
  divider.addEventListener('pointerdown', e => { dragging = true; divider.setPointerCapture(e.pointerId); });
  divider.addEventListener('pointermove', e => { if (dragging) moveDivider(e.clientX); });
  divider.addEventListener('pointerup', () => { dragging = false; });
  divider.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') moveDivider(divider.offsetLeft + (e.key === 'ArrowLeft' ? -24 : 24)); });

  // ---- about dialog
  const dialog = el('dialog', { class: 'about' },
    el('h2', { text: 'Los Roques, from satellite data' }),
    el('p', { text: 'An archipelago of some 350 islands, cays and sandbanks 130 km off the Venezuelan coast: a 44 by 27 km coral platform around a shallow lagoon, a national park since 1972. Only Gran Roque is rock; everything else is white carbonate sand, mangrove and reef.' }),
    el('p', { text: 'The islands, shorelines, water depths and seabed in this simulation are derived from Sentinel-2 imagery (10 m), the Copernicus elevation model, the Allen Coral Atlas reef maps and OpenStreetMap. Depths inside the lagoon are estimated from the colour of the water, so they are plausible rather than surveyed. Detail finer than about 11 m (beach profiles, ripples, waves, foam) is generated.' }),
    el('p', { text: 'The sun follows the real date and time for 11.85° N. Wind, waves, cloud and sea temperature follow monthly climate normals.' }),
    el('h3', { text: 'Data' }),
    el('ul', {}, ...app.attribution.map(a => el('li', { text: a }))),
    el('form', { method: 'dialog' }, el('button', { text: 'Close' })));

  root.append(panel, divider, dialog);
  if (matchMedia('(max-width: 640px)').matches) { panel.classList.add('collapsed'); toggle.setAttribute('aria-expanded', 'false'); }

  /** Refreshes the widgets from the environment state. */
  return function sync(status) {
    if (document.activeElement !== time) time.value = String(env.hours);
    timeOut.textContent = clock(env.hours);
    play.textContent = env.playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', env.playing ? 'Pause' : 'Play a day');
    month.value = String(env.month);
    for (const b of weather.children) b.setAttribute('aria-pressed', String(b.dataset.id === env.weather && env.windOverride == null));
    if (document.activeElement !== wind) wind.value = String(status.wind);
    windOut.textContent = `${Math.round(knots(status.wind))} kn ${compass(status.windFrom)}`;
    sunOut.textContent = status.sunElevation > 0 ? `Sun ${status.sunElevation.toFixed(0)}° above the horizon · rises ${clock(status.sunrise)}, sets ${clock(status.sunset)}`
      : `Sun below the horizon · rises ${clock(status.sunrise)}`;
    facts.textContent = `Typical ${MONTHS[env.month]}: sea ${status.sea.toFixed(1)} °C, air up to ${status.airMax} °C`;
    const comparing = status.compare >= 0;
    divider.hidden = !comparing; compare.checked = comparing;
    if (comparing && !dragging) divider.style.left = `${status.compare * 100}%`;
  };
}
