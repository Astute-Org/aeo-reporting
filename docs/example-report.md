# Example company standing report

All names and numbers below are **fictional**. This illustrates the report's
interpretation; it is not a benchmark, measured customer result, or API response.

Company: **Acme Analytics**. One fixed panel of 20 buyer questions, asked once of
each of three configured engines, produces 60 successful answers.

| Measure | Example result | Meaning |
|---|---|---|
| Mentioned | 18 / 60 = 30% | Answers that name Acme in prose |
| Cited | 12 / 60 = 20% | Answers citing a source on Acme's domain |
| Questions covered | 12 / 20 = 60% | Distinct questions with at least one Acme mention |
| Share of voice | 18 / (18 + 42) = 30% | Acme mentions relative to Acme plus declared competitors |
| Rank | 2 of 4 mentioned brands | Sorted by distinct questions, then total mentions |

An illustrative leaderboard consistent with those figures:

| Brand | Questions mentioned in | Total mentions across answers |
|---|---:|---:|
| Northstar Metrics | 15 | 24 |
| Acme Analytics | 12 | 18 |
| Beacon Reports | 9 | 12 |
| Summit Data | 4 | 6 |

The same answer can mention several brands. Each brand counts at most once per
answer, and each question counts at most once per brand across its engine answers.

## How to read it

Acme appears on most questions in this panel, but Northstar appears on more.
That is a position measurement. A single reading says nothing about a trend or
whether any particular marketing activity caused the result.

Open individual answers to see what was actually said, including whether a brand
was recommended, compared, dismissed, or merely mentioned. Inspect results per
engine: the combined totals do not imply that each engine treats a brand alike.

The app displays sample sizes and confidence intervals. Failed calls are excluded
from rate denominators. A missing measurement remains `null`, not zero. Edits to
the panel create a new version, and changing the competitor list changes the
share-of-voice denominator. Compare like-for-like readings over time.
