// Entry: creates the deterministic simulation, the three.js renderer and the UI.
// The simulation instance is exported as `CitySim` and also exposed on `window.CitySim`.
import './style.css';
import { CitySim as Simulation } from './sim/city.js';
import { CityRenderer } from './render/renderer.js';
import { mountPanel } from './ui/panel.js';
import { mountHud } from './ui/hud.js';

const seed = Number(new URLSearchParams(location.search).get('seed')) || 20261023;
export const CitySim = new Simulation(seed);
window.CitySim = CitySim;

const app = document.getElementById('app');
const world = document.createElement('div');
world.className = 'world';
app.appendChild(world);

const view = new CityRenderer(world, CitySim);
const hud = mountHud(app, CitySim, view);
mountPanel(app, CitySim, view, hud);
view.start();
