import type { Passage } from "./api";

/**
 * Built-in passage for offline/dev use (vite dev without the worker) and as a
 * graceful degradation if the API is unreachable. VOA Learning English text —
 * public domain, verbatim from the linked article (fetched 2026-07-10).
 */
export const FALLBACK_PASSAGE: Passage = {
  id: null,
  text:
    "South Korea's statistics agency said recently that 238,300 babies were born last year, " +
    "an increase of 8,300 from a year earlier. The data represents the first time that the " +
    "yearly number of births has increased since 2015.",
  word_count: 38,
  title: "Researchers: South Korea's birth rate increase last year unclear",
  url: "https://learningenglish.voanews.com/a/researchers-south-korea-s-birth-rate-increase-last-year-unclear-/7997203.html",
  attribution: "As It Is — VOA Learning English (public domain)",
  track: "news",
};
