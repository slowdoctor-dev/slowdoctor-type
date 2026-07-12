#!/usr/bin/env python3
"""Generate migrations/0009_vocab_seed.sql — GRE-level vocabulary passages.

Word selection and plain-English definitions are original content written for
this project (CC0) — no third-party wordlist or dictionary text is copied.
Format: 5 "Word: definition." entries per passage, so mistyped words flow
straight into the existing weak-word SRS. Regenerate with:
  python3 scripts/gen_vocab_seed.py > migrations/0009_vocab_seed.sql
"""

WORDS = [
    ("abate", "to become less strong or intense"),
    ("aberrant", "departing from what is normal or expected"),
    ("abstruse", "hard to understand without special knowledge"),
    ("alacrity", "cheerful and eager readiness"),
    ("ambivalent", "holding mixed feelings about something"),
    ("ameliorate", "to make a bad situation better"),
    ("anomaly", "something that differs from the usual pattern"),
    ("antipathy", "a deep and lasting dislike"),
    ("arduous", "requiring great effort and endurance"),
    ("assuage", "to soothe a feeling or ease a pain"),
    ("audacious", "boldly daring, often beyond convention"),
    ("austere", "severe, plain, and without comfort"),
    ("belie", "to give a false impression of something"),
    ("bolster", "to support, strengthen, or reinforce"),
    ("burgeon", "to grow or expand rapidly"),
    ("cacophony", "a harsh mixture of unpleasant sounds"),
    ("capricious", "changing mood or behavior without warning"),
    ("castigate", "to criticize or punish severely"),
    ("catalyst", "something that triggers or speeds up change"),
    ("caustic", "bitingly sarcastic or corrosive"),
    ("chicanery", "trickery used to deceive someone"),
    ("cogent", "clear, logical, and convincing"),
    ("commensurate", "matching something in size or degree"),
    ("conciliatory", "intended to calm anger and restore trust"),
    ("confound", "to confuse, or to prove wrong in a surprising way"),
    ("convoluted", "twisted and overly complicated"),
    ("copious", "present in large and plentiful amounts"),
    ("corroborate", "to confirm with supporting evidence"),
    ("craven", "shamefully lacking in courage"),
    ("cursory", "quick and without careful attention"),
    ("dearth", "a scarce supply or lack of something"),
    ("deference", "polite respect for another's judgment"),
    ("deleterious", "causing harm, often subtly"),
    ("demur", "to raise a polite objection"),
    ("denigrate", "to unfairly belittle or defame"),
    ("desultory", "aimless and lacking a plan"),
    ("diatribe", "a bitter verbal attack"),
    ("didactic", "intended to teach, often preachily"),
    ("diffident", "shy from lack of self-confidence"),
    ("dilatory", "slow, tending to cause delay"),
    ("disparate", "so different as to defy comparison"),
    ("dogmatic", "asserting opinions as unquestionable truth"),
    ("ebullient", "overflowing with cheerful energy"),
    ("eclectic", "drawn from many different sources"),
    ("efficacy", "the power to produce the intended result"),
    ("elucidate", "to explain and make clear"),
    ("empirical", "based on observation rather than theory"),
    ("enervate", "to drain of strength or vitality"),
    ("engender", "to cause a feeling or condition to arise"),
    ("ephemeral", "lasting for only a very short time"),
    ("equivocate", "to speak vaguely to avoid commitment"),
    ("erudite", "showing deep scholarly knowledge"),
    ("esoteric", "understood by only a small circle"),
    ("eulogy", "a speech of high praise, often for the dead"),
    ("exacerbate", "to make a problem worse"),
    ("exculpate", "to clear someone of blame"),
    ("exigent", "urgent and demanding immediate action"),
    ("facetious", "joking at an inappropriate moment"),
    ("fastidious", "extremely attentive to detail and standards"),
    ("fervent", "intensely passionate and heartfelt"),
    ("fortuitous", "happening by lucky chance"),
    ("frugal", "careful and sparing with money or resources"),
    ("garrulous", "talking too much about trivial things"),
    ("gregarious", "sociable and fond of company"),
    ("hackneyed", "worn out from overuse; unoriginal"),
    ("harangue", "a long, aggressive lecture"),
    ("iconoclast", "one who attacks cherished beliefs"),
    ("impetuous", "acting suddenly without thought"),
    ("inchoate", "just begun and not yet fully formed"),
    ("indefatigable", "never tiring, persistently energetic"),
    ("ineffable", "too great to be expressed in words"),
    ("ingenuous", "innocently frank and trusting"),
    ("insipid", "dull, flat, and lacking flavor or interest"),
    ("intransigent", "refusing to compromise"),
    ("inveterate", "long established and unlikely to change"),
    ("irascible", "easily provoked to anger"),
    ("laconic", "using very few words"),
    ("laud", "to praise highly"),
    ("loquacious", "extremely talkative"),
    ("magnanimous", "generous toward a rival or enemy"),
    ("mendacious", "habitually dishonest"),
    ("mercurial", "unpredictably changeable in mood"),
    ("mitigate", "to reduce the severity of something"),
    ("mollify", "to calm someone's anger"),
    ("myopic", "short-sighted in judgment or planning"),
    ("nascent", "newly born and beginning to develop"),
    ("obdurate", "stubbornly refusing to change one's mind"),
    ("obfuscate", "to deliberately make unclear"),
    ("obsequious", "excessively eager to please or obey"),
    ("obviate", "to make unnecessary by anticipation"),
    ("onerous", "involving a heavy, oppressive burden"),
    ("ostentatious", "showy in a way meant to impress"),
    ("paucity", "a shortage; too small an amount"),
    ("pedantic", "overly concerned with minor rules and detail"),
    ("perfunctory", "done as a routine, without care"),
    ("pragmatic", "guided by practical results, not theory"),
    ("prescient", "knowing events before they happen"),
    ("prevaricate", "to avoid telling the truth directly"),
    ("prodigal", "wastefully extravagant"),
    ("quiescent", "quiet, still, and inactive for a time"),
    ("recalcitrant", "stubbornly resistant to authority"),
    ("taciturn", "habitually silent and reserved"),
]

PER_PASSAGE = 5
PER_ARTICLE = 5  # passages per article


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def main() -> None:
    print("-- vocab track seed: GRE-level words with plain-English definitions.")
    print("-- Original content written for this project (CC0). Generated by")
    print("-- scripts/gen_vocab_seed.py — regenerate rather than hand-editing.")
    passages = [WORDS[i : i + PER_PASSAGE] for i in range(0, len(WORDS), PER_PASSAGE)]
    articles = [passages[i : i + PER_ARTICLE] for i in range(0, len(passages), PER_ARTICLE)]
    for a_idx, chunk in enumerate(articles, start=1):
        art_id = f"vocab-set-{a_idx}"
        title = f"GRE vocabulary, set {a_idx}"
        print(
            f"\nINSERT OR IGNORE INTO articles (id, url, title, source, track, license, attribution, published_at, fetched_at) "
            f"VALUES ('{art_id}', '', '{title}', 'authored', 'vocab', 'cc0', "
            f"'GRE-level vocabulary with plain-English definitions — original content (CC0)', NULL, datetime('now'));"
        )
        for p_idx, entries in enumerate(chunk):
            text = " ".join(f"{w.capitalize()}: {d}." for w, d in entries)
            wc = len(text.split())
            print(
                f"INSERT OR IGNORE INTO passages (article_id, seq, text, word_count) "
                f"VALUES ('{art_id}', {p_idx}, '{sql_escape(text)}', {wc});"
            )


if __name__ == "__main__":
    main()
