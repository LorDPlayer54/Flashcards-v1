import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true });
const page = await ctx.newPage(); page.on('dialog', d => d.accept());
const base = 'http://localhost:4173/';
const files = ['/home/claude/data/ref.csv','/home/claude/flashcards-ena/fixtures/anglais_fictif.csv','/home/claude/flashcards-ena/fixtures/economie_fictif.csv','/tmp/perf/perf.csv'];
await page.goto(base + '#/import');
await page.setInputFiles('input[type=file]', files);
for (let i=0;i<files.length;i++){
  await page.waitForSelector('text=Analyser le fichier'); 
  let t=Date.now(); await page.click('text=Analyser le fichier'); await page.waitForSelector("text=Résultat de l'analyse"); const ta=Date.now()-t;
  // v1.1 : QCM non analysables exclus par défaut ; ce fichier de volume les importe explicitement comme questions ouvertes (cf. perf4.mjs)
  if (await page.locator('text=Les importer quand même comme questions ouvertes').count()) { await page.check('text=Les importer quand même comme questions ouvertes'); await page.waitForSelector('.action-bar button:has-text("Confirmer")'); }
  t=Date.now(); await page.click('.action-bar button.primary'); await page.waitForSelector('text=Importation réussie', { timeout: 120000 }); console.log(files[i].split('/').pop(), 'analyse', ta,'ms, import+reload', Date.now()-t,'ms');
  if (i<files.length-1) await page.click('text=Fichier suivant');
}
let t=Date.now(); await page.goto(base); await page.reload(); await page.waitForSelector('.today-card'); console.log('cold open', Date.now()-t,'ms', (await page.locator('.today-card').innerText()).replace(/\n/g,' '));
t=Date.now(); await page.goto(base+'#/test/setup?n=root'); await page.click('.segmented[aria-label="Nombre de cartes"] button:text-is("Toutes")'); await page.click('.action-bar button'); await page.waitForSelector('.run-bar'); console.log('start test all cards', Date.now()-t,'ms', await page.locator('.run-count').innerText());
await page.goto(base+'#/search'); t=Date.now(); await page.fill('input[type=search]','fictive 7499'); await page.waitForFunction(()=>document.querySelector('.result-count')?.textContent?.includes('trouvée') && !document.body.textContent.includes('Recherche…')); await page.waitForTimeout(300); console.log('search', Date.now()-t, 'ms', await page.locator('.result-count').innerText());
await browser.close();
