#!/usr/bin/env python3
"""Generate migrations/0004_daily_seed.sql — authored everyday-reply passages.

Original content written for this project (CC0). Register: things you would
actually type into a chat window, an email, or a reply thread.
"""

GROUPS = {
    "daily-work-chat": ("Work chat", [
        "Could you take another look at the draft when you have a minute? I reworked the second half, and I am not sure the transition still makes sense. No rush, tomorrow morning is totally fine.",
        "Quick update before I log off. The export issue turned out to be a caching problem, not a data problem. I pushed a fix and left a note in the thread so the night shift knows what changed.",
        "I think we are talking past each other, so let me try to restate your point. You are saying the delay comes from the review step, not the build itself. If that is right, then I agree we should fix the process first.",
        "Sorry, I missed your message earlier. I was in a meeting all afternoon. The short answer is yes, we can move the deadline, but I would rather cut scope than push the date again. Can we talk for ten minutes tomorrow?",
        "Thanks for catching that typo before it went out. I read the paragraph three times and still missed it. I owe you a coffee. The corrected version is already uploaded, so we should be good now.",
        "Before we ship this, can someone double check the numbers in the summary table? They looked slightly off to me, but I might just be comparing them against an older version of the report.",
    ]),
    "daily-scheduling": ("Scheduling", [
        "Does Thursday at three still work for you? If not, I am free most of Friday morning. I would rather find a time when nobody has to rush than squeeze this into thirty minutes today.",
        "I need to reschedule our call, something urgent came up at the clinic. Could we do the same time on Wednesday instead? Sorry for the short notice, and thanks for understanding.",
        "Just confirming what we agreed on. You will send the first draft by Monday, I will add comments by Wednesday, and we review everything together on Friday. Tell me if I got any part of that wrong.",
        "Let's push this to next week. Half the team is out, and I do not want to make a decision this size without them. I will send a new invite once I see everyone's calendar.",
        "Running about ten minutes late, the previous meeting went over. Please start without me. I will read the notes and catch up, so do not repeat anything on my account.",
    ]),
    "daily-feedback": ("Replies and feedback", [
        "I see your point, but I disagree with the conclusion. The data shows a real difference between the two groups, just a smaller one than we hoped for. I would call it a weak positive result, not a failure.",
        "This is much better than the last version. The opening is clear, and the examples actually support the argument now. My only remaining concern is the ending, which still feels rushed to me.",
        "Honest question, not a criticism. Why did we choose this library over the standard one? If there is a good reason, let's write it down somewhere, because the next person will ask the same thing.",
        "Thanks for the detailed review. I accepted most of your suggestions and left comments where I did not. The one about splitting the long function was especially good, the code reads much better now.",
        "I would not read too much into one bad week. The trend over the last three months is still upward, and we changed two things at once, so we cannot even say which one caused the dip.",
        "You are right, my earlier reply was too blunt, and I am sorry about that. I was frustrated with the tool, not with you. Your question was fair, and I should have answered it properly.",
    ]),
    "daily-social": ("Everyday messages", [
        "Congratulations on the new position. Nobody deserves it more. You spent years doing the unglamorous work that made everyone else look good, and I am glad someone finally noticed.",
        "The photos from the trip look amazing. The one from the mountain at sunrise does not even look real. How long did you have to hike to get up there before dawn?",
        "Thank you for the recommendation. I finished the book in three days, which I have not done in years. The middle section about learning to slow down hit closer to home than I expected.",
        "Sorry to hear you have been sick all week. Do not worry about the plans we made, they will keep. Rest properly, drink more water than you think you need, and text me when you feel human again.",
        "I tried the recipe you sent and it actually worked, which surprised both of us I am sure. The sauce needed a little more salt, but the family asked for it again, so it is now officially in the rotation.",
        "It was really good to see everyone last weekend. We should not let it go another two years before the next one. I will start a group chat so someone besides you has to do the organizing this time.",
    ]),
}

def sq(s):
    return s.replace("'", "''")

lines = [
    "-- daily track seed: authored everyday-reply passages, original content (CC0).",
    "-- Register: chat messages, emails, review replies — things you actually type.",
]
total = 0
for aid, (label, passages) in GROUPS.items():
    lines.append("")
    lines.append(
        "INSERT OR IGNORE INTO articles (id, url, title, source, track, license, attribution, published_at, fetched_at) "
        f"VALUES ('{aid}', '', '{sq(label)}', 'authored', 'daily', 'cc0', 'everyday replies — original content (CC0)', NULL, datetime('now'));"
    )
    for i, p in enumerate(passages):
        wc = len(p.split())
        assert 20 <= wc <= 60, f"{aid}[{i}] has {wc} words"
        lines.append(
            f"INSERT OR IGNORE INTO passages (article_id, seq, text, word_count) VALUES ('{aid}', {i}, '{sq(p)}', {wc});"
        )
        total += 1

out = "migrations/0004_daily_seed.sql"
open(out, "w").write("\n".join(lines) + "\n")
print(f"{total} passages -> {out}")
