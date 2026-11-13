# Mastery Book

A standards-based grading gradebook and reteach planner for middle and high school math teachers.

**Live:** https://mastery-book-murex.vercel.app

## The pain

Teachers moving to mastery grading get stuck on the same things: which calculation to use (most recent, highest, decaying average, power law, mode), what to do with reassessments, and how to explain a grade to a family. The usual answer is a fragile spreadsheet, and the LMS gives a number nobody can trace.

## What it does

- **Import** Google Classroom, Canvas, Khan Academy assignment scores, PowerSchool-style or any CSV gradebook, an assessment-to-standard mapping (several standards per assessment, item tags), optional item scores per standard, and custom standards. Format detection, column mapping and a validation report with line numbers.
- **Bundled standards:** Common Core Math grades 6 to 8 and high school Algebra 1 / Functions / Statistics codes with short descriptions (CCSS public license, cited in `/docs`).
- **Engine** (plain TypeScript, tested): configurable proficiency scales; mastery per student per standard by most recent, highest, mean, decaying average (weight configurable), power law (least squares on log scores), mode and most recent N; reassessment rules (replace, higher, average, keep); letter-grade conversion by share of standards met or average level; method comparison; growth over time; capacity-constrained reteach grouping.
- **Actions:** reteach plans per group with Khan Academy search links, printable one-page family reports with growth sparklines, heatmap export (CSV and coloured XLSX), and a "why is my grade B" explainer per student.
- **History:** term snapshots with a compare view.
- **Accounts (optional):** local-first in IndexedDB; sign in to sync via Supabase. Student names never leave the device; synced data uses pseudonymous ids.
- Two synthetic sample classes (fictional students).

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests
npm run build
```

Optional sync: copy `.env.example` to `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Independent project, not affiliated with Khan Academy.
