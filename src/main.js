/**
 * main.js — Ponto de entrada (bootstrap).
 * Apenas instancia o Engine e inicia. Toda a lógica vive em src/core,
 * src/world, src/entities, src/systems e src/ui (Skill §2: nunca um
 * main.js gigante).
 */
import { Engine } from './core/Engine.js';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Elemento #app não encontrado no index.html');
}

const engine = new Engine(container);
engine.start();

// Expõe p/ debug no console do navegador (ex.: engine.performance.getStats()).
window.__operationZero = engine;
