// Boot: start the app, drive the loading screen, expose the test API.
import { start } from './app.js';

const loader = document.getElementById('loader'), text = document.getElementById('loader-text'), bar = document.getElementById('loader-bar');
const LR = (window.__LR = { errors: [] });
LR.ready = start(document.getElementById('view'), (fraction, label) => {
  bar.style.width = `${Math.round(fraction * 100)}%`;
  text.textContent = `Loading ${label}…`;
}).then(api => {
  api.errors.push(...LR.errors);
  Object.assign(LR, api);
  loader.classList.add('done');
  return true;
}).catch(e => {
  console.error(e);
  LR.errors.push(String(e?.message || e));
  loader.classList.add('failed');
  text.textContent = `Could not start: ${e?.message || e}`;
  return false;
});
