import * as scoring from "./scoring";

export interface TestResult {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  correctChars: number;
  typedChars: number;
  perSecondRaw: number[];
}

export interface EngineCallbacks {
  onProgress(liveWpm: number, liveAcc: number): void;
  onFinish(result: TestResult): void;
}

type CharState = "pending" | "correct" | "wrong";

/**
 * Character-stream typing engine.
 *
 * Model: the passage is a flat char sequence. Every printable keypress
 * advances the cursor and is judged against the target char at that position
 * (monkeytype-style "continue past errors"); backspace steps back. Keystroke
 * counts are press-time facts (a later correction doesn't rewrite them);
 * final-state correct chars drive net WPM. Formulas live in scoring.ts.
 */
export class TypingEngine {
  private readonly chars: string[];
  private readonly states: CharState[];
  private pos = 0;
  private startedAt: number | null = null;
  private finished = false;
  private correctKeystrokes = 0;
  private totalKeystrokes = 0;
  private keystrokeTimes: number[] = [];
  private readonly spans: HTMLSpanElement[] = [];
  private readonly caret: HTMLDivElement;
  private caretMoveTimer: number | undefined;
  private progressTimer: number | undefined;

  constructor(
    passageText: string,
    private readonly container: HTMLElement,
    private readonly callbacks: EngineCallbacks,
  ) {
    this.chars = [...passageText];
    this.states = this.chars.map(() => "pending");
    this.container.textContent = "";
    this.container.classList.remove("loading");

    const frag = document.createDocumentFragment();
    for (const c of this.chars) {
      const span = document.createElement("span");
      span.className = "c";
      span.textContent = c;
      frag.appendChild(span);
      this.spans.push(span);
    }
    this.caret = document.createElement("div");
    this.caret.id = "caret";
    frag.appendChild(this.caret);
    this.container.appendChild(frag);
    this.positionCaret();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get hasStarted(): boolean {
    return this.startedAt !== null;
  }

  /** Returns true if the key event was consumed by the test. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.finished) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;

    if (e.key === "Backspace") {
      if (this.pos > 0) {
        this.pos--;
        this.setState(this.pos, "pending");
        this.positionCaret();
      }
      return true;
    }
    if (e.key.length !== 1) return false;

    const now = performance.now();
    if (this.startedAt === null) {
      this.startedAt = now;
      this.startProgressTicker();
    }
    const expected = this.chars[this.pos];
    const correct = e.key === expected;
    this.setState(this.pos, correct ? "correct" : "wrong");
    this.totalKeystrokes++;
    if (correct) this.correctKeystrokes++;
    this.keystrokeTimes.push(now - this.startedAt);
    this.pos++;
    this.positionCaret();

    if (this.pos >= this.chars.length) {
      this.finish(now);
    }
    return true;
  }

  destroy(): void {
    window.clearInterval(this.progressTimer);
    window.clearTimeout(this.caretMoveTimer);
  }

  private setState(index: number, state: CharState): void {
    this.states[index] = state;
    const span = this.spans[index];
    span.classList.toggle("correct", state === "correct");
    span.classList.toggle("wrong", state === "wrong");
  }

  private positionCaret(): void {
    const target =
      this.pos < this.spans.length ? this.spans[this.pos] : this.spans[this.spans.length - 1];
    const atEnd = this.pos >= this.spans.length;
    this.caret.style.left = `${target.offsetLeft + (atEnd ? target.offsetWidth : 0)}px`;
    this.caret.style.top = `${target.offsetTop}px`;

    // solid while moving, blink when idle
    this.caret.classList.add("moving");
    window.clearTimeout(this.caretMoveTimer);
    this.caretMoveTimer = window.setTimeout(() => this.caret.classList.remove("moving"), 500);

    // keep the active line vertically centered in the 3-line window
    const lineHeight = target.offsetHeight;
    const desiredTop = Math.max(0, target.offsetTop - lineHeight);
    if (Math.abs(this.container.scrollTop - desiredTop) > 2) {
      this.container.scrollTop = desiredTop;
    }
  }

  private startProgressTicker(): void {
    this.progressTimer = window.setInterval(() => {
      if (this.startedAt === null || this.finished) return;
      const elapsed = performance.now() - this.startedAt;
      if (elapsed < 1000) return;
      const correctChars = this.states.filter((s) => s === "correct").length;
      this.callbacks.onProgress(
        scoring.wpm(correctChars, elapsed),
        scoring.accuracy(this.correctKeystrokes, this.totalKeystrokes),
      );
    }, 500);
  }

  private finish(now: number): void {
    this.finished = true;
    window.clearInterval(this.progressTimer);
    const durationMs = Math.max(1, Math.round(now - (this.startedAt ?? now)));
    const correctChars = this.states.filter((s) => s === "correct").length;

    const result: TestResult = {
      wpm: scoring.wpm(correctChars, durationMs),
      rawWpm: scoring.rawWpm(this.totalKeystrokes, durationMs),
      accuracy: scoring.accuracy(this.correctKeystrokes, this.totalKeystrokes),
      consistency: scoring.consistency(this.perSecondRaw(durationMs)),
      durationMs,
      correctChars,
      typedChars: this.totalKeystrokes,
      perSecondRaw: this.perSecondRaw(durationMs),
    };
    this.callbacks.onFinish(result);
  }

  private perSecondRaw(durationMs: number): number[] {
    const seconds = Math.max(1, Math.ceil(durationMs / 1000));
    const buckets = new Array<number>(seconds).fill(0);
    for (const t of this.keystrokeTimes) {
      const i = Math.min(seconds - 1, Math.floor(t / 1000));
      buckets[i]++;
    }
    return buckets.map((count, i) => {
      const bucketMs = i === seconds - 1 ? durationMs - (seconds - 1) * 1000 || 1000 : 1000;
      return (count / 5) * (60_000 / bucketMs);
    });
  }
}
