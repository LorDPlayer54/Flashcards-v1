// Mise à jour PWA 1.1.0 → 1.2.0 sur la même origine, profil de navigateur persistant (Chromium automatisé, pas un appareil réel).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 4191, base = `http://localhost:${PORT}/`;
const start = (dir) => new Promise((res) => { const p = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', String(PORT), '--strictPort'], { cwd: '/home/claude/flashcards-ena', detached: true }); p.stdout.on('data', (d) => String(d).includes('localhost') && res(p)); });
const stop = async (p) => { process.kill(-p.pid); await new Promise((r) => setTimeout(r, 800)); };
const res = []; const ok = (n, c, x = '') => res.push(`${c ? 'OK ' : 'ÉCHEC'} ${n} ${x}`);
const errors = [];
const dump = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const rq = indexedDB.open('flashcards-ena');
  rq.onerror = () => reject(rq.error);
  rq.onsuccess = async () => {
    const db = rq.result; const out = { version: db.version, stores: [...db.objectStoreNames] };
    for (const s of out.stores) out[s] = await new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
    db.close(); resolve(out);
  };
}));
const profile = '/tmp/pw-up-' + Date.now();
let srv = await start('/tmp/up-a');
let ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 375, height: 740 }, isMobile: true });
let page = ctx.pages()[0] ?? (await ctx.newPage()); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
await page.goto(base); await page.evaluate(() => navigator.serviceWorker.ready);
ok('1.1.0 : titre', (await page.title()) === 'Flashcards ENA', await page.title());
// Données d'une utilisatrice 1.1.0 : import CSV, puis état de mémorisation, historique et ancienne préférence « dernier test »
await page.goto(base + '#/import'); await page.setInputFiles('input[type=file]', '/home/claude/flashcards-ena/fixtures/economie_fictif.csv');
await page.click('text=Analyser le fichier'); await page.waitForSelector("text=Résultat de l'analyse"); await page.click('.action-bar button'); await page.waitForSelector('text=Importation réussie');
await page.evaluate(() => new Promise((resolve) => {
  const rq = indexedDB.open('flashcards-ena');
  rq.onsuccess = () => {
    const db = rq.result; const tx = db.transaction(['cards', 'reviewStates', 'reviewLog', 'settings'], 'readwrite');
    const q = tx.objectStore('cards').getAllKeys(null, 1);
    q.onsuccess = () => {
      const id = q.result[0];
      tx.objectStore('reviewStates').put({ cardId: id, status: 'review', reviewCount: 1, lapses: 0, successStreak: 1, lastRating: 'good', intervalDays: 3, firstReviewedDay: '2026-11-02', lastReviewedAt: '2026-11-02T09:00:00.000Z', lastReviewedDay: '2026-11-02', dueDay: '2026-11-05' });
      tx.objectStore('reviewLog').put({ logId: 'up-1', cardId: id, sessionId: 's-up', at: '2026-11-02T09:00:00.000Z', day: '2026-11-02', rating: 'good', repeat: false, intervalDays: 3, dueDay: '2026-11-05' });
      tx.objectStore('settings').put({ key: 'defaultCorrection', value: 'last' });
      tx.objectStore('settings').put({ key: 'lastTestConfig', value: { count: 10, format: 'all', order: 'library', correction: 'end' } });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
  };
}));
const before = await dump(page);
// Sauvegarde 1.1.0 téléchargée
await page.goto(base + '#/more'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Télécharger une sauvegarde')]);
await dl.saveAs('/tmp/up-backup-110.json');
await stop(srv);
// ---------- 1.2.0 servie à la même adresse ----------
srv = await start('/tmp/up-b');
await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update()).catch(() => undefined);
await page.waitForTimeout(1500);
const banner = await page.locator('text=nouvelle version').count();
if (banner) await page.click('.system-banner button:has-text("Mettre à jour")').catch(() => undefined);
await page.waitForTimeout(1500); await page.goto(base); await page.reload(); await page.waitForTimeout(800);
ok('bandeau de mise à jour proposé', banner > 0);
ok('1.2.0 servie : titre Flashcard', (await page.title()) === 'Flashcard', await page.title());
ok('version affichée 1.2.0', (await (await page.goto(base + '#/more?p=app'), page.waitForTimeout(500), page.evaluate(() => document.body.innerText))).includes('1.2.0'));
const after = await dump(page);
ok('base IndexedDB conservée (nom, version, magasins)', after.version === before.version && JSON.stringify(after.stores) === JSON.stringify(before.stores), `v${after.version}`);
for (const s of ['cards', 'collections', 'reviewStates', 'reviewLog', 'sessions']) ok(`données conservées : ${s}`, JSON.stringify(after[s]) === JSON.stringify(before[s]), `${after[s].length}`);
const caches = await page.evaluate(async () => caches.keys());
ok('cache du service worker : préfixe inchangé, une seule version', caches.length === 1 && caches[0].startsWith('flashcards-ena-'), JSON.stringify(caches));
// Ancienne préférence « dernier test » convertie en préférence explicite
await page.goto(base + '#/more?p=testing'); await page.waitForSelector('[role=switch]');
ok('préférence « dernier test » migrée (fin de test)', (await page.getAttribute('[role=switch]', 'aria-checked')) === 'false');
const pref = (await dump(page)).settings.find((x) => x.key === 'defaultCorrection');
ok('préférence enregistrée explicitement', pref?.value === 'end', JSON.stringify(pref));
// Hors connexion
await ctx.setOffline(true); await page.goto(base + '#/library'); await page.reload(); await page.waitForTimeout(800);
ok('hors connexion : bibliothèque affichée', (await page.evaluate(() => document.body.innerText)).includes('Bibliothèque'));
await page.goto(base + '#/search'); await page.fill('#search-input', 'fictive'); await page.waitForTimeout(800);
ok('hors connexion : recherche', (await page.locator('.result-count').innerText()).includes('trouvée'), await page.locator('.result-count').innerText());
await ctx.setOffline(false);
// Restauration d'une sauvegarde 1.1.0 dans la 1.2.0
await page.goto(base + '#/restore'); await page.setInputFiles('input[type=file]', '/tmp/up-backup-110.json'); await page.waitForSelector('text=Contenu de la sauvegarde', { timeout: 8000 }).catch(async () => { console.log(res.join('\n')); console.log('RESTORE PAGE', (await page.locator('.page').innerText()).replace(/\s+/g, ' ').slice(0, 900)); process.exit(2); });
if (await page.locator('text=Sauvegarder mes données actuelles').count()) { const [d2] = await Promise.all([page.waitForEvent('download'), page.click('text=Sauvegarder mes données actuelles')]); await d2.saveAs('/tmp/up-before-restore.json'); }
if (await page.locator("text=J'ai vérifié que le fichier de sauvegarde").count()) await page.check("text=J'ai vérifié que le fichier de sauvegarde");
await page.click('.action-bar button'); await page.waitForSelector('text=Sauvegarde restaurée');
const restored = await dump(page);
for (const s of ['cards', 'collections', 'reviewStates', 'reviewLog']) ok(`restauration 1.1.0 → 1.2.0 : ${s}`, JSON.stringify(restored[s]) === JSON.stringify(before[s]), `${restored[s].length}`);
const mf = await (await page.request.get(base + 'manifest.webmanifest')).json();
ok('manifeste : nom Flashcard, id/scope/start_url inchangés', mf.name === 'Flashcard' && mf.short_name === 'Flashcard' && mf.id === './' && mf.scope === './' && mf.start_url === './');
console.log(res.join('\n')); console.log('ERRORS', JSON.stringify(errors));
await ctx.close(); await stop(srv); process.exit(0);
