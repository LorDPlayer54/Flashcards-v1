// Plus › Aide › Guide : index et dix articles de lecture (contenu local, aucune écriture).
import { GUIDE, GUIDE_GROUPS, articleById, type Block, type ToolTarget } from '../../guide/articles';
import { ROOT_ID } from '../../taxonomy/tree';
import { Icon, TopBar } from '../components/common';
import { href, type Route } from '../router';

const TARGETS: Record<ToolTarget, string> = {
  library: href('library'),
  program: href('program'),
  review: href('review'),
  test: href('test/setup', { n: ROOT_ID }),
  import: href('import'),
};

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return <p key={i}>{b.text}</p>;
          case 'note':
            return (
              <p key={i} className="guide-note" role="note">
                {b.text}
              </p>
            );
          case 'section':
            return (
              <section key={i} className="guide-section">
                <h2>{b.title}</h2>
                <Blocks blocks={b.blocks} />
              </section>
            );
          case 'steps':
            return (
              <ol key={i} className="guide-steps">
                {b.items.map((s, k) => (
                  <li key={k}>
                    <span className="guide-step-n" aria-hidden="true">
                      {k + 1}
                    </span>
                    <span>
                      <strong>{s.title}</strong>
                      <span>{s.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            );
          case 'grades':
            return (
              <ul key={i} className="guide-grades">
                {b.items.map((g) => (
                  <li key={g.cat}>
                    <i className={`dot ev-${g.cat}`} aria-hidden="true" />
                    <span>
                      <strong>{g.title}</strong>
                      <span>{g.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            );
          case 'list':
            return (
              <ul key={i} className="guide-list">
                {b.items.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ul>
            );
          case 'tools':
            return (
              <ul key={i} className="setting-list guide-tools">
                {b.items.map((t) => (
                  <li key={t.target}>
                    <a className="setting-row" href={TARGETS[t.target]}>
                      <span className="setting-txt">
                        <span className="setting-title">{t.title}</span>
                      </span>
                      <span className="setting-end">
                        <Icon name="chevron" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </>
  );
}

export function Guide({ route }: { route: Route }) {
  const article = articleById(route.path[1]);
  if (route.path[1] && !article) {
    return (
      <div className="page">
        <TopBar title="Guide" back={href('guide')} backLabel="Guide" />
        <p className="notice">Cet article n'existe pas.</p>
        <a className="btn secondary block" href={href('guide')}>
          Retour au Guide
        </a>
      </div>
    );
  }
  if (article) {
    return (
      <div className="page guide-article">
        <TopBar title={article.title} eyebrow="Guide pratique" back={href('guide')} backLabel="Retour au Guide" lead={article.intro} />
        <Blocks blocks={article.blocks} />
        {(article.cta || article.related) && (
          <section className="guide-section">
            <h2>Pour continuer</h2>
            {article.cta && (
              <a className="btn primary block" href={TARGETS[article.cta.target]}>
                {article.cta.label}
                <Icon name="arrow" />
              </a>
            )}
            {article.related && (
              <ul className="setting-list">
                {article.related.map((id) => {
                  const r = articleById(id);
                  return r ? (
                    <li key={id}>
                      <a className="setting-row" href={href(`guide/${r.id}`)}>
                        <span className="setting-txt">
                          <span className="setting-title">{r.title}</span>
                        </span>
                        <span className="setting-end">
                          <Icon name="chevron" />
                        </span>
                      </a>
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    );
  }
  return (
    <div className="page guide-index">
      <TopBar title="Guide" back={href('more')} backLabel="Plus" lead="Tout comprendre à votre rythme, des premières cartes jusqu'aux révisions." />
      <a className="guide-feature" href={href('guide/start')}>
        <span className="setting-icon">
          <Icon name="book" />
        </span>
        <span>
          <small>Nouveau sur Flashcard ?</small>
          <strong>Commencez ici</strong>
          <span>Trois étapes pour préparer votre première séance.</span>
        </span>
        <Icon name="arrow" />
      </a>
      {GUIDE_GROUPS.map((g) => (
        <section key={g} className="setting-group">
          <h2 className="setting-group-title">{g}</h2>
          <ul className="setting-list">
            {GUIDE.filter((a) => a.group === g).map((a) => (
              <li key={a.id}>
                <a className="setting-row" href={href(`guide/${a.id}`)}>
                  <span className="setting-txt">
                    <span className="setting-title">{a.title}</span>
                    <span className="setting-sub">{a.desc}</span>
                  </span>
                  <span className="setting-end">
                    <Icon name="chevron" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
