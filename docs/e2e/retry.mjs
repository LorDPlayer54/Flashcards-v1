import { nextAfterEval } from './legacyProgram.mjs';
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
const base = 'http://localhost:4173/';
await page.goto(base + '#/import');
await page.setInputFiles('input[type=file]', ['/home/claude/flashcards-ena/fixtures/mini_reference_fictif.csv']);
await page.click('text=Analyser le fichier');
await page.waitForSelector("text=Résultat de l'analyse");
console.log('MINI', (await page.locator('.kv').first().innerText()).replace(/\n/g,' '));
console.log('ISSUES', (await page.locator('.issues').innerText()).replace(/\n/g,' '));
await page.click('.action-bar button'); await page.waitForSelector('text=Importation réussie');
// Raisonnement direct card (FIC-007): library Raisonnement page should list "Cartes rattachées directement"
await page.goto(base + '#/library'); await page.click('.list-row:has-text("Raisonnement")');
await page.waitForSelector('h2:has-text("Raisonnement")');
console.log('RAIS page sections:', await page.locator('.section-title').allInnerTexts());
await page.screenshot({ path: '/home/claude/shots/20-rais.png' });
// test all, order library, then Terminer early
await page.goto(base + '#/test/setup?n=root');
await page.click('.segmented[aria-label="Nombre de cartes"] button:text-is("Toutes")');
await page.click('.action-bar button');
await page.waitForSelector('.run-bar');
// answer first: whatever type
async function answerOne(wrong) {
  // v1.2 : attendre une question non encore répondue (les transitions laissent brièvement la carte précédente)
  await page.waitForSelector('button:has-text("Voir la réponse"), .options .option:not([disabled])');
  const before = await page.locator('.run-count').innerText();
  if (await page.locator('text=Voir la réponse').count()) { await page.click('text=Voir la réponse'); await page.locator('.eval-grid button').nth(wrong ? 0 : 2).click(); await nextAfterEval(page); }
  else { await page.locator('.options .option:not([disabled])').first().click(); await page.click('text=Valider'); const nx = page.locator('.action-bar button:has-text("Suivant"), .action-bar button:has-text("Voir le bilan")').first(); await nx.waitFor(); await nx.click(); }
  await page.waitForFunction((b) => document.querySelector('.run-count')?.textContent !== b, before).catch(() => undefined);
}
await answerOne(true); await answerOne(true); await answerOne(false);
// quit and resume from home
await page.click('text=Quitter'); await page.waitForSelector('text=Reprendre le test');
console.log('RESUME card', (await page.locator('a:has-text("Reprendre le test")').locator('xpath=..').innerText()).replace(/\n/g,' '));
await page.click('text=Reprendre le test'); await page.waitForSelector('.run-bar');
console.log('resumed at', await page.locator('.run-count').innerText());
await page.click('text=Terminer'); await page.waitForSelector('text=Bilan du test');
console.log('SUM', (await page.locator('.sum-hero').innerText()).replace(/\n/g,' '));
await page.click('text=Refaire les erreurs');
await page.waitForSelector('h1:has-text("Test libre")');
console.log('RETRY', (await page.locator('.scope-card').first().innerText()).replace(/\n/g,' '));
await page.screenshot({ path: '/home/claude/shots/21-retry.png' });
// Reload on setup from selection → expired message
await page.reload(); await page.waitForTimeout(500);
console.log('AFTER RELOAD', (await page.locator('.page').innerText()).replace(/\n/g,' ').slice(0,120));
// Card detail + delete (Fiche V3 : la provenance est repliée sous « Provenance et informations de la carte »)
await page.goto(base + '#/search'); await page.fill('input[type=search]', 'négation'); await page.waitForTimeout(600);
await page.locator('.search-row').first().click(); await page.waitForSelector('text=Provenance');
await page.screenshot({ path: '/home/claude/shots/22-card.png', fullPage: true });
await page.click('text=Supprimer cette carte'); await page.waitForTimeout(500);
console.log('after delete url', page.url().slice(page.url().indexOf('#')));
await page.goto(base + '#/'); await page.waitForSelector('.today-card');
console.log('HOME', (await page.locator('.today-card').innerText()).replace(/\n/g,' '));
// Export
await page.goto(base + '#/more?p=backup'); await page.waitForSelector('#backup-name');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Télécharger ma sauvegarde')]);
const p = await dl.path(); const j = JSON.parse(require_fs().readFileSync(p,'utf8'));
console.log('EXPORT', dl.suggestedFilename(), j.format, j.version, JSON.stringify(j.counts));
function require_fs(){ return createRequire(import.meta.url)('fs'); }
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
