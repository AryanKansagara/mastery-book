import { useEffect, useMemo, useState } from 'react'
import { Heatmap, ToneLegend } from './charts.tsx'
import { compareMethods, METHODS, methodLabel } from './engine/mastery.ts'
import { generate, sampleConfig } from './engine/sample.ts'
import type { Method } from './engine/types.ts'
import { Link } from './ui.tsx'

const HERO_METHODS: Method[] = ['recent', 'decaying', 'powerlaw', 'mean']
const SHOWN = 12

function HeroDemo() {
  const { cmp, cfg } = useMemo(() => {
    const ds = generate('grade7'), cfg = sampleConfig('grade7')
    return { cmp: compareMethods(ds, cfg, HERO_METHODS), cfg }
  }, [])
  // Show the students the method debate is about: most disagreement first, then a few who never move.
  const order = useMemo(() => {
    const idx = cmp.rows.map((r, i) => ({ i, r })).sort((a, b) => b.r.spread - a.r.spread || a.r.name.localeCompare(b.r.name))
    const pick = [...idx.slice(0, SHOWN - 3), ...idx.filter(x => x.r.spread === 0).slice(0, 3)].sort((a, b) => a.r.name.localeCompare(b.r.name))
    return pick.map(x => x.i)
  }, [cmp])
  const [method, setMethod] = useState<Method>('recent')
  const [prev, setPrev] = useState<Method | null>(null)
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!auto || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => {
      if (document.hidden) return
      setMethod(m => { setPrev(m); return HERO_METHODS[(HERO_METHODS.indexOf(m) + 1) % HERO_METHODS.length] })
    }, 3400)
    return () => clearInterval(t)
  }, [auto])

  const full = cmp.mats[method]
  const m = { standards: full.standards, students: order.map(i => full.students[i]), cells: order.map(i => full.cells[i]) }
  const prevLetters = prev ? Object.fromEntries(cmp.rows.map(r => [r.id, r.letters[prev]])) : undefined
  const changed = prev ? cmp.changed(prev, method) : 0
  const vsRecent = cmp.changed('recent', method)
  const dist = cmp.dist[method]

  return (
    <div className="demo">
      <div className="demo-bar">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <strong>Grade 7 Math, Period 3</strong><span className="badge synthetic">Synthetic class</span>
      </div>
      <div className="demo-body">
        <div className="seg-control" role="radiogroup" aria-label="Calculation method">
          {HERO_METHODS.map(id => (
            <button key={id} type="button" role="radio" aria-checked={method === id} className={method === id ? 'on' : ''}
              onClick={() => { setAuto(false); if (id !== method) { setPrev(method); setMethod(id) } }}>{METHODS.find(x => x.id === id)!.label}</button>
          ))}
        </div>
        <div className="demo-kpis" aria-live="polite">
          <div><b>{dist.A ?? 0}</b><small>A grades</small></div>
          <div><b>{(dist.D ?? 0) + (dist.F ?? 0)}</b><small>D or F</small></div>
          <div><b className="pulse-num" key={method}>{prev ? changed : vsRecent}</b><small>{prev ? `letters moved vs ${METHODS.find(x => x.id === prev)!.short.toLowerCase()}` : 'letters moved'}</small></div>
        </div>
        <Heatmap m={m} cfg={cfg} prev={prevLetters} caption={`Synthetic grade 7 class under ${methodLabel(method, cfg)}`} />
        <div className="row between wrap gap-sm"><ToneLegend cfg={cfg} /><span className="tiny muted">{SHOWN} of 28 students · real engine, same scores</span></div>
      </div>
    </div>
  )
}

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow light">For teachers moving to standards-based grading</div>
            <h1>Grades that can <span className="hl">explain themselves.</span></h1>
            <p className="lede">Mastery Book turns your Google Classroom, Canvas or PowerSchool gradebook into a student-by-standard picture, using the calculation your department actually agreed on. Then it plans the reteach groups and writes the family report.</p>
            <div className="hero-ctas">
              <Link href="/app?sample=grade7" className="btn primary lg">Try the sample class</Link>
              <Link href="/app" className="btn outline lg">Import your gradebook</Link>
            </div>
            <p className="hero-note">Free, no account needed. Student names stay in your browser.</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">What teachers keep asking</div>
          <h2>The hard part of mastery grading is not the idea. It is the arithmetic and the explaining.</h2>
        </div>
        <div className="quotes">
          <figure className="quote"><blockquote>Which calculation do we use: most recent, highest, decaying average, power law? Every one gives a different grade.</blockquote><p>The recurring question in &ldquo;advice for mastery / standards based grading implementation&rdquo; threads.</p><figcaption className="src">Paraphrased from r/Teachers</figcaption></figure>
          <figure className="quote"><blockquote>The kid scored 1, 2, then 4. Is that a 2.3 or a 4? Reassessments make the spreadsheet impossible.</blockquote><p>Tracking mastery per standard with retakes by hand is where most implementations stall.</p><figcaption className="src">Paraphrased from r/Teachers and r/mathteachers</figcaption></figure>
          <figure className="quote"><blockquote>Mastery points feel like a black box. I could not tell a parent why the number moved.</blockquote><p>Learners and teachers want to see how a mastery level was earned, not just the badge.</p><figcaption className="src">Paraphrased from r/Khan</figcaption></figure>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>From gradebook export to a reteach plan in one sitting</h2>
        </div>
        <div className="steps">
          <div className="step"><b>1</b><h3>Import</h3><p>Drop the CSV from Google Classroom, Canvas, PowerSchool or anywhere. Format detection, column mapping and a validation report with line numbers.</p></div>
          <div className="step"><b>2</b><h3>Tag standards</h3><p>Tag each assessment with Common Core codes (bundled for grades 6 to 8 and Algebra 1), or import a mapping. Items on a unit test can be tagged one by one.</p></div>
          <div className="step"><b>3</b><h3>Pick the rules</h3><p>Scale, calculation method, reassessment rule and the letter-grade conversion. Every number is traceable to the scores behind it.</p></div>
          <div className="step"><b>4</b><h3>Act</h3><p>Reteach groups with Khan Academy practice links, printable family reports, a heatmap for the department, and term snapshots.</p></div>
        </div>
      </section>

      <section className="section">
        <div className="features">
          <article className="feature"><div className="ico" aria-hidden="true">&#8644;</div><h3>Compare methods</h3><p>Seven calculation methods side by side, with how many students change letter under each. Bring it to the department meeting instead of a hypothetical.</p></article>
          <article className="feature"><div className="ico" aria-hidden="true">&#9673;</div><h3>Reteach groups</h3><p>Students clustered by the standards they have not met, into k groups with a size cap, each with a short plan and practice links.</p></article>
          <article className="feature"><div className="ico" aria-hidden="true">?</div><h3>&ldquo;Why is my grade B?&rdquo;</h3><p>Per-student explainer: every score, what a reassessment replaced, the arithmetic, the rule that fired, and what it takes to reach the next letter.</p></article>
          <article className="feature"><div className="ico" aria-hidden="true">&#9998;</div><h3>Family reports</h3><p>One page per student in plain language with a growth sparkline per skill. Print the class or save as PDF.</p></article>
          <article className="feature"><div className="ico" aria-hidden="true">&#9638;</div><h3>Heatmap export</h3><p>Class standards heatmap as CSV or a coloured XLSX with a method-comparison sheet.</p></article>
          <article className="feature"><div className="ico" aria-hidden="true">&#8634;</div><h3>Term snapshots</h3><p>Freeze each progress report and compare terms: who moved up, which standards grew.</p></article>
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-inner">
          <div><h2>See your own class in ten minutes</h2><p>Works signed out. Sign in only if you want it on another device; names never sync.</p></div>
          <div className="row gap wrap"><Link href="/docs" className="btn outline-light lg">Export guides</Link><Link href="/app" className="btn primary lg">Open Mastery Book</Link></div>
        </div>
      </section>
    </>
  )
}
