// Affichage sûr d'un texte de carte : jamais de HTML exécuté.
// Formules : seules les délimitations LaTeX explicites \( … \), \[ … \] et $$ … $$ sont rendues par KaTeX
// (le « $ » simple est ignoré pour ne pas confondre avec des montants en dollars).
import katex from 'katex';
import { memo } from 'react';

const MATH_RE = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;

export type Segment = { type: 'text'; value: string } | { type: 'math'; tex: string; display: boolean };

export function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) });
    const raw = m[0];
    if (raw.startsWith('$$')) out.push({ type: 'math', tex: raw.slice(2, -2), display: true });
    else if (raw.startsWith('\\[')) out.push({ type: 'math', tex: raw.slice(2, -2), display: true });
    else out.push({ type: 'math', tex: raw.slice(2, -2), display: false });
    last = idx + raw.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

function renderTex(tex: string, display: boolean): string {
  // trust:false interdit \href, \url, \htmlClass… ; KaTeX échappe le texte : aucune injection HTML possible.
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 500 });
}

export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const segments = splitMath(text);
  return (
    <div className={`rich ${className ?? ''}`}>
      {segments.map((s, i) =>
        s.type === 'text' ? (
          <span key={i}>{s.value}</span>
        ) : (
          <span key={i} className={s.display ? 'math-block' : 'math-inline'} dangerouslySetInnerHTML={{ __html: renderTex(s.tex, s.display) }} />
        ),
      )}
    </div>
  );
});
