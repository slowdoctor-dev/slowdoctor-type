/** Query a required element; throws early if the markup drifted. */
export const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

/** Resolved theme token (e.g. cssVar("--accent")) — keeps canvas drawing in
 * sync with the stylesheet palette. */
export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
