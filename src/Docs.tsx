import { METHODS } from './engine/mastery.ts'
import { CCSS, CCSS_SOURCE } from './engine/standards.ts'
import { Code, Link } from './ui.tsx'

const LONG = `student id,student name,assessment,date,score,points possible
S1001,Ada Okafor,Quiz 1.1 Unit rates,2026-08-28,8,10
S1001,Ada Okafor,Unit 1 Test,2026-09-15,31,40
S1002,"Ng, Bo",Unit 1 Test,2026-09-15,Missing,40`

const MAPPING = `assessment,standard,item,date,points possible,reassessment of
Unit 1 Test,7.RP.A.1,Q1,2026-09-15,40,
Unit 1 Test,7.RP.A.1,Q2,,,
Unit 1 Test,7.RP.A.2,Q3,,,
Unit 1 Test,7.RP.A.3,Q4,,,
Quiz 1.2 Proportional relationships,7.RP.A.2,,2026-09-04,10,
Reassessment: Quiz 1.2,7.RP.A.2,,2026-09-24,10,Quiz 1.2 Proportional relationships`

const ITEMS = `student id,assessment,item,score,max
S1001,Unit 1 Test,Q1,9,10
S1001,Unit 1 Test,Q2,7,10
S1001,Unit 1 Test,Q3,10,10
# or name the standard directly instead of an item:
student id,assessment,standard,score,max
S1001,Unit 1 Test,7.RP.A.3,6,10`

const STANDARDS = `code,description
ALG.1,Writes and solves linear equations from a context
ALG.2,Interprets slope and intercept in context`

export default function Docs() {
  return (
    <section className="page narrow docs">
      <div className="eyebrow">Docs</div>
      <h1>Getting your gradebook in</h1>
      <p className="lede">Mastery Book needs three things: your gradebook scores, which standards each assessment measures, and optionally item-level scores per standard. Everything is parsed in your browser.</p>
      <p className="muted small">Export steps written in November 2026 from each vendor&rsquo;s help center. Menu names change; if a step does not match, look for the export option on the same screen.</p>
      <nav className="toc" aria-label="On this page">
        <a href="#classroom">Google Classroom</a><a href="#canvas">Canvas</a><a href="#powerschool">PowerSchool</a><a href="#generic">Any CSV</a><a href="#mapping">Standards mapping</a><a href="#items">Item scores</a><a href="#methods">Methods</a><a href="#privacy">Privacy and sync</a><a href="#standards">Standards source</a>
      </nav>

      <h2 id="classroom">Google Classroom</h2>
      <ol>
        <li>Open the class and go to <b>Classwork</b>. Click any assignment, then <b>View assignment</b> (or open the <b>Student work</b> tab).</li>
        <li>Click the <b>Settings</b> gear at the top right and choose <b>Download all grades as CSV</b>. (<b>Copy all grades to Google Sheets</b> works too; then <b>File &gt; Download &gt; Comma-separated values</b>.)</li>
        <li>Drop the CSV on the class&rsquo;s <b>Data &amp; setup</b> tab. Mastery Book reads the header row (Last Name, First Name, Email Address, then one column per assignment), plus the <b>Date</b> and <b>Points</b> rows when present, and skips summary columns like Overall.</li>
      </ol>
      <p className="small muted">Email addresses become pseudonymous ids so the same student matches across re-imports.</p>

      <h2 id="canvas">Canvas</h2>
      <ol>
        <li>In the course, open <b>Grades</b>.</li>
        <li>Click <b>Export</b> and choose <b>Export Entire Gradebook</b>. Canvas builds a CSV and downloads it.</li>
        <li>Drop the CSV in. The <b>Points Possible</b> row sets each assessment&rsquo;s maximum, the numeric suffix on assignment names (&ldquo;Unit 1 Quiz (48213)&rdquo;) is removed, &ldquo;Last, First&rdquo; becomes &ldquo;First Last&rdquo;, and Current/Final/Unposted score columns are ignored.</li>
        <li>Canvas exports have no due dates. Column order is used as time order until you add dates on the Assessments panel or in a mapping file. Time order matters for most recent, decaying average and power law.</li>
      </ol>
      <p className="small muted">If you already use Canvas Outcomes, keep tagging there; here you tag each assignment once on the Assessments panel.</p>

      <h2 id="powerschool">PowerSchool (PowerTeacher Pro) and similar SIS gradebooks</h2>
      <ol>
        <li>In PowerTeacher Pro open <b>Grading &gt; Scoresheet</b> for the class and use the export option to download the scoresheet as CSV. That file is one column per assignment and imports as a wide gradebook.</li>
        <li>Or ask your data team for an <b>assignment scores</b> extract with one row per score: Student Number, Student Name, Assignment, Due Date, Score, Points Possible. Mastery Book detects that layout as &ldquo;PowerSchool-style&rdquo;.</li>
      </ol>
      <p className="small muted">Not affiliated with or tested against a live PowerSchool district; any CSV with those columns works.</p>

      <h2 id="generic">Any CSV</h2>
      <p>Either one column per assessment (students in rows) or one row per score:</p>
      <Code code={LONG} label="scores.csv" />
      <ul>
        <li>Scores can be points (<code>8</code>), fractions (<code>8/10</code>) or percents (<code>80%</code>). If you score directly on the 1 to 4 scale, set <b>Scores are: already proficiency levels</b> in Grading setup (detected automatically when every assessment is out of 4 or 5).</li>
        <li><code>Missing</code>, <code>M</code> and <code>Absent</code> are not counted as evidence: a missing assessment is not a zero on a standard. <code>EX</code> and <code>Excused</code> are ignored. Both are counted in the validation report.</li>
        <li>Dates: <code>2026-09-15</code>, <code>9/15/2026</code> or <code>Sep 15, 2026</code>. Excel files: save as CSV first.</li>
      </ul>

      <h2 id="mapping">Standards mapping</h2>
      <p>One assessment can measure several standards, and individual items can be tagged. Tag on the Assessments panel, or import a mapping file (one row per assessment and standard, or several codes in one cell separated by <code>;</code>):</p>
      <Code code={MAPPING} label="mapping.csv" />
      <ul>
        <li>Codes are normalized: <code>7.EE.1</code>, <code>CCSS.MATH.CONTENT.7.EE.A.1</code> and <code>7.EE.A.1</code> are the same standard. High school codes like <code>HSA-REI.B.3</code> become <code>A-REI.B.3</code>.</li>
        <li><b>reassessment of</b> links a retake to the original. The class rule decides what happens: the retake replaces the original (default), the higher score stands, the two are averaged, or both count.</li>
        <li><b>item</b> tags a question to a standard, so an item scores file can give each standard its own score on a multi-standard test.</li>
      </ul>

      <h2 id="items">Item scores per standard (optional)</h2>
      <p>Without item scores, a unit test&rsquo;s overall percent counts for every standard it covers. With them, each standard gets its own evidence:</p>
      <Code code={ITEMS} label="items.csv" />
      <p>Custom standards (district targets, I-can statements) can be added with a two-column file:</p>
      <Code code={STANDARDS} label="standards.csv" />

      <h2 id="methods">Calculation methods</h2>
      <p>Every method uses the same evidence: each score converted to a level with your scale&rsquo;s cut-offs (4-point default: 90% Advanced, 75% Proficient, 60% Developing), after the reassessment rule is applied. The calculated value is rounded to a level (nearest by default, or down).</p>
      <dl className="method-defs">{METHODS.map(m => <div key={m.id}><dt>{m.label}</dt><dd>{m.how}</dd></div>)}</dl>
      <p>Letter grades come from the levels, not from points. The default rule: A needs 90% of standards at Proficient with none below 2; B 75% with none below 2; C 60%; D 40%. You can switch to an average-level rule and edit every threshold on the Data &amp; setup tab. The <Link href="/app">Compare methods</Link> tab shows how many letters each choice moves, which is the question most department meetings are actually arguing about.</p>

      <h2 id="privacy">Privacy and sync</h2>
      <ul>
        <li>Classes live in this browser (IndexedDB). No account is needed.</li>
        <li>Signing in (email and password) syncs classes, mappings, grading rules, scores and term snapshots. <b>Student names are stripped before anything is sent</b>; the cloud copy only has pseudonymous ids (a hash of the student ID or email from your export). On a new device, re-import the gradebook to see names again.</li>
        <li>Pseudonymous is not anonymous: anyone holding your original export could recompute the ids. Treat the cloud copy as student data and use your district&rsquo;s rules.</li>
        <li>Gradebooks larger than 1.5 MB stay on the device; settings and snapshots still sync.</li>
        <li>Account menu: export everything as JSON, delete your cloud data, or delete the account.</li>
        <li>Practice links open a Khan Academy search page. Nothing is fetched from Khan Academy and no student data is sent there.</li>
      </ul>

      <h2 id="standards">Standards source</h2>
      <p>{CCSS.length} standard codes are bundled: {CCSS_SOURCE.source}. Codes are the official identifiers from <a href={CCSS_SOURCE.url} target="_blank" rel="noreferrer">the Common Core State Standards for Mathematics</a>; descriptions are shortened paraphrases written for this app, and the Khan Academy search terms are mine.</p>
      <p className="small">License: {CCSS_SOURCE.license}</p>
      <p className="small muted">{CCSS_SOURCE.attribution}</p>
    </section>
  )
}
