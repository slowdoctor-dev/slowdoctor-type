// Account panel: social sign-in (Google / Kakao / GitHub), account linking,
// and profile customization — nickname + composed avatar (emoji × background
// hue, no image uploads; randomized server-side at signup).

export interface Me {
  nickname: string;
  avatar: string; // "<emoji>|<hue>"
}

const PROVIDERS = ["google", "kakao", "github"] as const;

// keep in sync with AVATAR_EMOJIS in worker/src/auth.rs
const AVATAR_EMOJIS = [
  "⌨️", "🐢", "🦉", "🌿", "🌊", "⚡", "🔥", "🌙", "☕", "🩺", "🧠", "🌸",
  "🐈", "🐕", "🦆", "🐧", "🍀", "🍊", "🎯", "🎹", "📚", "🚀", "🪐", "🧭",
];
const AVATAR_HUES = [0, 25, 45, 90, 130, 160, 200, 230, 270, 300, 330];

export function parseAvatar(avatar: string): { emoji: string; hue: number } {
  const [emoji, hueRaw] = avatar.split("|");
  const hue = Number(hueRaw);
  if (!emoji || !Number.isFinite(hue)) return { emoji: "⌨️", hue: 160 };
  return { emoji, hue: ((hue % 360) + 360) % 360 };
}

function paintAvatar(el: HTMLElement, avatar: string): void {
  const { emoji, hue } = parseAvatar(avatar);
  el.textContent = emoji;
  el.style.background = `hsl(${hue} 30% 32%)`;
}

let me: Me | null = null;
let providers: string[] = [];
let notice = "";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

async function fetchMe(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const j = (await res.json()) as { user: Me | null; providers?: string[] };
    me = j.user;
    providers = j.providers ?? [];
  } catch {
    /* dev without worker */
  }
}

async function saveProfile(patch: Partial<Me>): Promise<void> {
  const res = await fetch("/api/me", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (res.ok && me) me = { ...me, ...patch };
}

function renderButton(): void {
  const btn = $("#account-btn");
  btn.textContent = "";
  if (!me) {
    btn.append("sign in");
    return;
  }
  const av = document.createElement("span");
  av.className = "avatar";
  paintAvatar(av, me.avatar);
  btn.append(av, me.nickname);
}

function el(tag: string, className: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

function renderModal(): void {
  const card = $("#account-card");
  card.textContent = "";

  const head = el("div", "dash-head");
  head.append(el("span", "dash-title", me ? "account" : "sign in"));
  const close = document.createElement("button");
  close.id = "a-close";
  close.type = "button";
  close.innerHTML = "close <kbd>esc</kbd>";
  close.addEventListener("click", closeModal);
  head.append(close);
  card.append(head);

  if (notice) card.append(el("div", "account-notice", notice));

  if (!me) {
    card.append(
      el(
        "div",
        "dash-sub",
        "history stays in this browser either way — signing in adds a profile and upcoming rankings",
      ),
    );
    const list = el("div", "provider-list");
    for (const p of PROVIDERS) {
      const a = document.createElement("a");
      a.className = "provider-btn";
      a.href = `/auth/login/${p}`;
      a.textContent = `continue with ${p}`;
      list.append(a);
    }
    card.append(list);
    return;
  }

  // --- profile: avatar preview + randomize ---
  const current = parseAvatar(me.avatar);
  const row = el("div", "avatar-row");
  const preview = el("span", "avatar avatar-big");
  paintAvatar(preview, me.avatar);
  const nick = document.createElement("input");
  nick.id = "a-nick";
  nick.maxLength = 20;
  nick.value = me.nickname;
  nick.setAttribute("aria-label", "nickname");
  nick.addEventListener("change", () => {
    const v = nick.value.trim();
    if (v) void saveProfile({ nickname: v });
  });
  const shuffle = document.createElement("button");
  shuffle.type = "button";
  shuffle.className = "quiet-btn";
  shuffle.textContent = "randomize";
  shuffle.addEventListener("click", () => {
    const emoji = AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
    const hue = Math.floor(Math.random() * 360);
    void saveProfile({ avatar: `${emoji}|${hue}` }).then(rerender);
  });
  row.append(preview, nick, shuffle);
  card.append(row);

  // --- avatar settings: emoji × hue ---
  card.append(el("div", "dash-sub", "avatar"));
  const grid = el("div", "emoji-grid");
  for (const emoji of AVATAR_EMOJIS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = emoji === current.emoji ? "emoji-opt active" : "emoji-opt";
    b.textContent = emoji;
    b.addEventListener("click", () => {
      void saveProfile({ avatar: `${emoji}|${parseAvatar(me!.avatar).hue}` }).then(rerender);
    });
    grid.append(b);
  }
  card.append(grid);
  const hues = el("div", "hue-row");
  for (const hue of AVATAR_HUES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = hue === current.hue ? "hue-opt active" : "hue-opt";
    b.style.background = `hsl(${hue} 30% 32%)`;
    b.title = `hue ${hue}`;
    b.addEventListener("click", () => {
      void saveProfile({ avatar: `${parseAvatar(me!.avatar).emoji}|${hue}` }).then(rerender);
    });
    hues.append(b);
  }
  card.append(hues);

  // --- linked sign-in methods ---
  card.append(el("div", "dash-sub", "sign-in methods"));
  const list = el("div", "provider-list");
  for (const p of PROVIDERS) {
    const row = el("div", "provider-row");
    if (providers.includes(p)) {
      row.append(el("span", "provider-linked", `✓ ${p}`));
      if (providers.length > 1) {
        const un = document.createElement("button");
        un.type = "button";
        un.className = "quiet-btn";
        un.textContent = "unlink";
        un.addEventListener("click", () => {
          void fetch(`/auth/unlink/${p}`, { method: "POST" }).then(async (r) => {
            if (r.ok) providers = providers.filter((x) => x !== p);
            rerender();
          });
        });
        row.append(un);
      }
    } else {
      const a = document.createElement("a");
      a.className = "provider-btn";
      a.href = `/auth/login/${p}?link=1`;
      a.textContent = `link ${p}`;
      row.append(a);
    }
    list.append(row);
  }
  card.append(list);

  const out = document.createElement("button");
  out.type = "button";
  out.className = "quiet-btn";
  out.textContent = "sign out";
  out.addEventListener("click", () => {
    void fetch("/auth/logout", { method: "POST" }).then(() => location.reload());
  });
  card.append(out);
}

function rerender(): void {
  renderButton();
  renderModal();
}

function openModal(): void {
  renderModal();
  $("#account").hidden = false;
}

function closeModal(): void {
  $("#account").hidden = true;
  notice = "";
}

export function accountModalOpen(): boolean {
  return !$("#account").hidden;
}

export async function initAccount(): Promise<void> {
  await fetchMe();
  renderButton();
  $("#account-btn").addEventListener("click", (e) => {
    openModal();
    (e.currentTarget as HTMLButtonElement).blur();
  });
  const overlay = $("#account");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!overlay.hidden && e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
  });

  // post-OAuth landing: /?auth=ok|linked|conflict|denied|expired
  const status = new URLSearchParams(location.search).get("auth");
  if (status) {
    history.replaceState(null, "", location.pathname);
    notice = {
      ok: me ? `signed in as ${me.nickname}` : "sign-in failed — try again",
      linked: "sign-in method linked",
      conflict: "that account is already linked to a different profile",
      denied: "sign-in cancelled",
      expired: "sign-in expired — try again",
    }[status] ?? "";
    if (notice) openModal();
  }
}
