import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = spawn('npx', ['vite', 'preview', '--port', '4205', '--strictPort'], { cwd: '/home/claude/flashcards-ena', detached: true });
process.on('exit', () => { try { process.kill(-srv.pid); } catch {} });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('localhost') && r()));
const base = 'http://localhost:4205/'; const S = '/home/claude/shots/'; const errors = [];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 320, height: 800 }, isMobile: true });
const p = await ctx.newPage(); p.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0,200))); p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base + '#/import'); await p.setInputFiles('input[type=file]', '/home/claude/flashcards-ena/fixtures/economie_fictif.csv');
await p.waitForSelector('text=Correspondance des colonnes'); await p.click('text=Analyser le fichier'); await p.waitForSelector("text=Résultat de l'analyse"); await p.click('.action-bar button'); await p.waitForSelector('text=Importation réussie');
await p.goto(base + '#/more?p=import'); await p.waitForSelector('text=Sélectionner');
const total = await p.locator('.del-count').first().innerText(); console.log('cartes collection', total);
await p.click('text=Sélectionner');
await p.locator('.del-toggle.strong').first().click(); await p.locator('.del-toggle').nth(1).click().catch(()=>{});
for (const w of [320, 360, 390]) for (const sc of ['light','dark']) { await p.setViewportSize({ width: w, height: 800 }); await p.emulateMedia({ colorScheme: sc }); await p.waitForTimeout(100); console.log(w, sc, 'débordement', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)); }
// sélection partielle d'un noeud
await p.locator('.del-tree .del-check').first().check();
console.log('barre :', (await p.locator('.deletion-bar').innerText()).replace(/\s+/g,' '));
const bar = await p.locator('.deletion-bar').boundingBox(); const nav = await p.locator('nav').last().boundingBox().catch(()=>null);
console.log('barre bottom', bar && bar.y + bar.height, 'nav top', nav && nav.y);
await p.setViewportSize({ width: 320, height: 800 }); await p.screenshot({ path: S + 'suppr-320-select.png' });
await p.click('button:has-text("Supprimer la sélection")'); await p.waitForSelector('[role=dialog]');
console.log('modale :', (await p.locator('[role=dialog]').innerText()).replace(/\s+/g,' '));
await p.screenshot({ path: S + 'suppr-320-confirm.png' });
await p.click('text=Annuler'); console.log('après annuler, cartes', await p.locator('.del-count').first().innerText());
await p.click('button:has-text("Supprimer la sélection")'); await p.click('button:has-text("Supprimer définitivement")'); await p.waitForTimeout(4000);
console.log('après suppression, cartes', await p.locator('.del-count').first().innerText().catch(()=>'-'), '|', await p.locator('[role=dialog]').count(), '|', (await p.locator('.notice').allInnerTexts()).join(' / '));
// collection entière
await p.click('text=Sélectionner'); await p.locator('input[aria-label^="Collection"]').first().check();
await p.click('button:has-text("Supprimer la sélection")'); await p.click('button:has-text("Supprimer définitivement")'); await p.waitForTimeout(4000);
console.log('après suppression entière :', (await p.locator('.notice, .recent-empty').allInnerTexts()).join(' / '));
console.log('ERRORS', JSON.stringify(errors)); await b.close(); process.exit(0);
