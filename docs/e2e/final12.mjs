import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = spawn('npx', ['vite', 'preview', '--port', '4206', '--strictPort'], { cwd: '/home/claude/flashcards-ena', detached: true });
process.on('exit', () => { try { process.kill(-srv.pid); } catch {} });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('localhost') && r()));
const base = 'http://localhost:4206/'; const S = '/home/claude/shots/'; const errors = []; const res = [];
const ok = (name, cond, extra = '') => { res.push(`${cond ? 'OK ' : 'ÉCHEC'} ${name} ${extra}`); };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
const h = () => p.evaluate(() => location.hash);
const imp = async (file) => { await p.goto(base + '#/import'); await p.setInputFiles('input[type=file]', file); await p.waitForSelector('text=Correspondance des colonnes'); await p.click('text=Analyser le fichier'); await p.waitForSelector("text=Résultat de l'analyse"); await p.click('.action-bar button'); await p.waitForSelector('text=Importation réussie'); };
await imp('/home/claude/flashcards-ena/fixtures/libelles_fictif.csv');
// titre et ENA
ok('titre onglet', (await p.title()) === 'Flashcard', await p.title());
const manifest = await (await p.request.get(base + 'manifest.webmanifest')).json();
ok('manifest', manifest.name === 'Flashcard' && manifest.short_name === 'Flashcard' && manifest.id === './' && manifest.start_url === './');
for (const r of ['#/', '#/library', '#/more', '#/more?p=app']) { await p.goto(base + r); await p.waitForTimeout(300); const t = await p.evaluate(() => document.body.innerText); ok('pas de « ENA » ' + r, !/\bENA\b/.test(t)); }
// Recherche
await p.goto(base + '#/search'); await p.waitForSelector('.result-count');
ok('recherche vide = toutes', (await p.locator('.result-count').innerText()).startsWith('14'), await p.locator('.result-count').innerText());
await p.fill('#search-input', 'CONSTITUTIONNALITE'); await p.waitForTimeout(600);
ok('recherche hors question (accents/casse)', (await p.locator('.result-count').innerText()).startsWith('14'));
ok('extrait contextuel', (await p.locator('.search-snippet').count()) > 0 && (await p.locator('.search-snippet mark').first().innerText()) === 'constitutionnalité');
await p.selectOption('#search-matiere', 'Droit administratif'); await p.waitForTimeout(600);
ok('filtre matière', (await p.locator('.result-count').innerText()).startsWith('5'));
await p.click('.segmented button:has-text("QCM")'); await p.waitForTimeout(600);
ok('zéro résultat + réinitialiser', await p.locator('text=Réinitialiser les filtres').isVisible());
await p.click('.segmented button:has-text("Tous")'); await p.waitForTimeout(600);
await p.screenshot({ path: S + 'f12-recherche-360.png', fullPage: true });
// fiche depuis recherche → Modifier → Annuler → retour à la recherche avec filtres
await p.locator('.search-row').first().click(); await p.waitForSelector('.answerbox');
await p.click('a:has-text("Modifier")'); await p.waitForSelector('.card-form');
await p.click('.edit-actions button:has-text("Annuler")'); await p.waitForTimeout(400);
ok('annuler sans changement → fiche', /^#\/card\/[^/]+$/.test(await h()), await h());
await p.click('.back-link'); await p.waitForTimeout(500);
ok('fiche → recherche, filtres conservés', (await h()).startsWith('#/search') && (await p.inputValue('#search-input')) === 'CONSTITUTIONNALITE' && (await p.inputValue('#search-matiere')) === 'Droit administratif', await h());
await p.click('button:has-text("Préparer un test sur ces cartes")'); await p.waitForTimeout(400);
ok('préparer un test sans lancer', (await h()).startsWith('#/test/setup'), await h());
// Bibliothèque → fiche → Modifier → changement → Annuler → Continuer / Abandonner
await p.goto(base + '#/library'); await p.goto(base + '#/search'); await p.fill('#search-input', ''); await p.selectOption('#search-matiere', ''); await p.waitForTimeout(600);
await p.locator('.search-row').first().click(); await p.waitForSelector('.answerbox'); const cardHash = await h();
const qBefore = await p.locator('.answerbox, h1, .card-question').first().innerText();
await p.click('a:has-text("Modifier")'); await p.waitForSelector('.card-form');
await p.fill('#f-question', 'Question modifiée puis abandonnée ?');
await p.click('.edit-actions button:has-text("Annuler")'); await p.waitForSelector('[role=dialog]');
await p.click("[role=dialog] button:has-text(\"Continuer l'édition\")"); await p.waitForTimeout(200);
ok('continuer l’édition', (await h()).endsWith('/edit') && (await p.inputValue('#f-question')) === 'Question modifiée puis abandonnée ?');
// Retour du navigateur / matériel avec modifications : confirmation, formulaire et valeurs conservés
await p.goBack(); await p.waitForSelector('[role=dialog]');
ok('retour navigateur modifié → confirmation, formulaire conservé', (await h()).endsWith('/edit') && (await p.inputValue('#f-question')) === 'Question modifiée puis abandonnée ?');
await p.click("[role=dialog] button:has-text(\"Continuer l'édition\")"); await p.waitForTimeout(200);
ok('continuer après retour navigateur : valeurs intactes', (await h()).endsWith('/edit') && (await p.inputValue('#f-question')) === 'Question modifiée puis abandonnée ?');
const histLen = await p.evaluate(() => history.length);
await p.click('nav a:has-text("Stats")'); await p.waitForSelector('[role=dialog]');
ok('barre de navigation modifié → confirmation', (await h()).endsWith('/edit'));
await p.click("[role=dialog] button:has-text(\"Continuer l'édition\")"); await p.waitForTimeout(300);
await p.goBack(); await p.waitForSelector('[role=dialog]');
await p.click('[role=dialog] button:has-text("Abandonner les modifications")'); await p.waitForTimeout(500);
ok('abandon depuis le retour navigateur → fiche', (await h()) === cardHash, await h());
await p.goForward().catch(() => undefined); await p.waitForTimeout(300);
await p.goBack().catch(() => undefined); await p.waitForTimeout(300);
await p.goto(base + cardHash + '/edit'); await p.waitForSelector('.card-form'); await p.goBack(); await p.waitForTimeout(300);
ok('retour navigateur sans modification : pas de confirmation', (await p.locator('[role=dialog]').count()) === 0 && !(await h()).endsWith('/edit'), await h());
void histLen;
await p.goto(base + cardHash); await p.waitForSelector('.answerbox');
await p.click('a:has-text("Modifier")'); await p.waitForSelector('.card-form');
await p.fill('#f-question', 'Question modifiée puis abandonnée ?');
await p.click('.back-link'); await p.waitForSelector('[role=dialog]');
await p.click('[role=dialog] button:has-text("Abandonner les modifications")'); await p.waitForTimeout(500);
ok('abandonner → fiche inchangée', (await h()) === cardHash && !(await p.evaluate(() => document.body.innerText)).includes('abandonnée'));
await p.goBack(); await p.waitForTimeout(400);
ok('retour navigateur après annulation : pas de formulaire', !(await h()).endsWith('/edit'), await h());
// Modifier → Enregistrer → fiche → retour
await p.goto(base + '#/library'); await p.waitForTimeout(300); await p.goto(base + cardHash); await p.waitForSelector('.answerbox');
await p.click('a:has-text("Modifier")'); await p.waitForSelector('.card-form');
await p.fill('#f-question', 'Question fictive enregistrée ?'); await p.click('.edit-actions button.primary'); await p.waitForTimeout(800);
ok('enregistrer → fiche', (await h()) === cardHash && (await p.evaluate(() => document.body.innerText)).includes('Question fictive enregistrée'), await h());
await p.click('.back-link'); await p.waitForTimeout(400);
ok('fiche → bibliothèque après enregistrement', (await h()).startsWith('#/library'), await h());
await p.goBack(); await p.waitForTimeout(300); const hb = await h();
ok('retour matériel : jamais le formulaire', !hb.endsWith('/edit'), hb);
// Ouverture directe d'une fiche (sans historique)
const p2 = await ctx.newPage(); await p2.goto(base + cardHash); await p2.waitForSelector('.answerbox'); await p2.click('.back-link'); await p2.waitForTimeout(300);
ok('fiche ouverte directement → niveau de la bibliothèque', (await p2.evaluate(() => location.hash)).startsWith('#/library'), await p2.evaluate(() => location.hash)); await p2.close();
// Réglages : switch
await p.goto(base + '#/more?p=testing'); await p.waitForSelector('[role=switch]');
const txt = await p.evaluate(() => document.body.innerText);
ok('switch unique, sans « dernier test »', (await p.locator('[role=switch]').count()) === 1 && !txt.includes('dernier test'));
ok('défaut activé', (await p.getAttribute('[role=switch]', 'aria-checked')) === 'true');
await p.click('[role=switch]'); await p.waitForTimeout(300);
await p.reload(); await p.waitForSelector('[role=switch]');
ok('désactivé conservé', (await p.getAttribute('[role=switch]', 'aria-checked')) === 'false');
for (const sc of ['light', 'dark']) { await p.emulateMedia({ colorScheme: sc }); await p.setViewportSize({ width: 320, height: 700 }); await p.screenshot({ path: `${S}f12-reglage-320-${sc}.png` }); }
await p.goto(base + '#/test/setup?from=library'); await p.waitForTimeout(800);
ok('préparation : fin de test présélectionnée', (await p.locator('.correction-setting [aria-pressed=true], .correction-setting [aria-checked=true], .correction-setting .active').first().innerText().catch(() => '?')).includes('fin'), await p.locator('.correction-setting').innerText().catch(()=>''));
// Libellés
await p.setViewportSize({ width: 360, height: 780 }); await p.emulateMedia({ colorScheme: 'light' });
await p.goto(base + '#/labels'); await p.waitForSelector('.labels-v1');
ok('suggestion détectée', (await p.locator('.labels-row').first().innerText()).includes('Finance'));
await p.locator('a.labels-row').first().click(); await p.waitForSelector('.merge-preview-v1');
ok('aperçu : 3 cartes déplacées', (await p.locator('.merge-big').innerText()) === '3', await p.locator('.merge-big').innerText());
await p.screenshot({ path: S + 'f12-libelles-apercu.png', fullPage: true });
await p.click('.action-bar button'); await p.waitForSelector('[role=dialog]');
await p.click('[role=dialog] button:has-text("Annuler")'); ok('annulation fusion', (await p.locator('[role=dialog]').count()) === 0);
await p.click('.action-bar button'); await p.click('[role=dialog] button:has-text("Confirmer la fusion")'); await p.waitForTimeout(800);
ok('fusion → bibliothèque', (await h()).startsWith('#/library'), await h());
await p.goto(base + '#/labels'); await p.waitForSelector('.labels-v1');
ok('règle mémorisée', (await p.evaluate(() => document.body.innerText)).includes('Finance publiques → Finances publiques'));
await p.click('button:has-text("Oublier")'); await p.waitForSelector('[role=dialog]'); await p.click('[role=dialog] button:has-text("Oublier la règle")'); await p.waitForTimeout(500);
ok('règle oubliée après confirmation', (await p.evaluate(() => document.body.innerText)).includes('oubliée'));
// Débordements
const pages = ['#/search', '#/labels', '#/more?p=testing', cardHash, cardHash + '/edit', '#/more?p=import'];
let worst = 0;
for (const w of [320, 360, 390]) for (const sc of ['light', 'dark']) { await p.setViewportSize({ width: w, height: 760 }); await p.emulateMedia({ colorScheme: sc }); for (const r of pages) { await p.goto(base + r); await p.waitForTimeout(350); const d = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (d > worst) worst = d; if (d > 0) res.push(`débordement ${w} ${sc} ${r} ${d}`); } }
ok('aucun débordement 320/360/390 clair/sombre', worst === 0);
await p.setViewportSize({ width: 320, height: 700 }); await p.emulateMedia({ colorScheme: 'dark' }); await p.goto(base + '#/search'); await p.fill('#search-input', 'budget'); await p.waitForTimeout(600); await p.screenshot({ path: S + 'f12-recherche-320-dark.png' });
await p.goto(base + cardHash + '/edit'); await p.waitForTimeout(400); await p.screenshot({ path: S + 'f12-edit-320-dark.png' });
console.log(res.join('\n')); console.log('ERRORS', JSON.stringify(errors)); await b.close(); process.exit(0);
