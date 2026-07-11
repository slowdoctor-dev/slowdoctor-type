// Account panel: social sign-in (Google / Kakao / GitHub), account linking,
// and profile customization — nickname + generated avatar (8×8 mirrored
// pattern × background hue; no image uploads, rerolled on click, randomized
// server-side at signup).

export interface Me {
  nickname: string;
  avatar: string; // "<8 hex chars>|<hue>" — 32 pattern bits + background hue
}

// brand marks inlined so the page stays dependency- and request-free
const PROVIDERS: { key: string; label: string; icon: string }[] = [
  {
    key: "google",
    label: "Google",
    icon: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-3c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5H1.2v3.1C3.2 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.2C.4 8.2 0 10 0 12s.4 3.8 1.2 5.4l3.9-3.1z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l2.7-2.7C16.9 1.3 14.2 0 12 0 7.3 0 3.2 2.7 1.2 6.6l3.9 3.1c1-2.9 3.7-5 6.9-5z"/></svg>`,
  },
  {
    key: "kakao",
    label: "Kakao",
    icon: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#FEE500" d="M12 3C6.5 3 2 6.5 2 10.8c0 2.8 1.9 5.2 4.7 6.6l-1 3.6c-.1.4.3.7.6.5l4.3-2.9c.5.1.9.1 1.4.1 5.5 0 10-3.5 10-7.9S17.5 3 12 3z"/></svg>`,
  },
  {
    key: "github",
    label: "GitHub",
    icon: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.6 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>`,
  },
];

const AVATAR_HUES = [0, 25, 45, 90, 130, 160, 200, 230, 270, 300, 330];
const DEFAULT_AVATAR = { bits: 0x3c5a7e42, hue: 160 };

/** `<8 hex>|<hue>` → 32 pattern bits + hue; anything malformed → default. */
export function parseAvatar(avatar: string): { bits: number; hue: number } {
  const [hex, hueRaw] = avatar.split("|");
  const hue = Number(hueRaw);
  if (!/^[0-9a-fA-F]{8}$/.test(hex ?? "") || !Number.isFinite(hue)) return { ...DEFAULT_AVATAR };
  return { bits: Number.parseInt(hex, 16), hue: ((hue % 360) + 360) % 360 };
}

export function randomPatternHex(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 8×8 identicon: 32 bits fill the left 4 columns row by row and are mirrored
 * to the right, so every pattern is symmetric.
 */
export function avatarSvg(avatar: string): string {
  const { bits, hue } = parseAvatar(avatar);
  const fg = `hsl(${hue} 45% 62%)`;
  const bg = `hsl(${hue} 25% 24%)`;
  let cells = "";
  for (let i = 0; i < 32; i++) {
    if (((bits >>> i) & 1) === 0) continue;
    const row = Math.floor(i / 4);
    const col = i % 4;
    cells += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
    cells += `<rect x="${7 - col}" y="${row}" width="1" height="1"/>`;
  }
  return (
    `<svg viewBox="0 0 8 8" width="100%" height="100%" aria-hidden="true" shape-rendering="crispEdges">` +
    `<rect width="8" height="8" fill="${bg}"/><g fill="${fg}">${cells}</g></svg>`
  );
}

function paintAvatar(el: HTMLElement, avatar: string): void {
  el.innerHTML = avatarSvg(avatar);
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
  btn.classList.toggle("signed-out", !me);
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

function providerAnchor(p: (typeof PROVIDERS)[number], link: boolean): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "provider-btn";
  a.href = link ? `/auth/login/${p.key}?link=1` : `/auth/login/${p.key}`;
  a.innerHTML = `${p.icon}<span>${link ? "link" : "continue with"} ${p.label}</span>`;
  return a;
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
    for (const p of PROVIDERS) list.append(providerAnchor(p, false));
    card.append(list);
    return;
  }

  // --- profile: avatar preview (click = new pattern) + nickname ---
  const row = el("div", "avatar-row");
  const preview = el("button", "avatar avatar-big") as HTMLButtonElement;
  preview.type = "button";
  preview.title = "new pattern";
  paintAvatar(preview, me.avatar);
  const reroll = (nextHue?: number) => {
    const hue = nextHue ?? parseAvatar(me!.avatar).hue;
    void saveProfile({ avatar: `${randomPatternHex()}|${hue}` }).then(rerender);
  };
  preview.addEventListener("click", () => reroll());
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
  shuffle.textContent = "new pattern";
  shuffle.addEventListener("click", () => reroll());
  row.append(preview, nick, shuffle);
  card.append(row);

  // --- avatar color ---
  card.append(el("div", "dash-sub", "avatar color — click the pattern to reroll it"));
  const current = parseAvatar(me.avatar);
  const hues = el("div", "hue-row");
  for (const hue of AVATAR_HUES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = hue === current.hue ? "hue-opt active" : "hue-opt";
    b.style.background = `hsl(${hue} 30% 32%)`;
    b.title = `hue ${hue}`;
    b.addEventListener("click", () => {
      const bits = parseAvatar(me!.avatar);
      const hex = (bits.bits >>> 0).toString(16).padStart(8, "0");
      void saveProfile({ avatar: `${hex}|${hue}` }).then(rerender);
    });
    hues.append(b);
  }
  card.append(hues);

  // --- linked sign-in methods ---
  card.append(el("div", "dash-sub", "sign-in methods"));
  const list = el("div", "provider-list");
  for (const p of PROVIDERS) {
    const row = el("div", "provider-row");
    if (providers.includes(p.key)) {
      const linked = el("span", "provider-linked");
      linked.innerHTML = `${p.icon}<span>✓ ${p.label}</span>`;
      row.append(linked);
      if (providers.length > 1) {
        const un = document.createElement("button");
        un.type = "button";
        un.className = "quiet-btn";
        un.textContent = "unlink";
        un.addEventListener("click", () => {
          void fetch(`/auth/unlink/${p.key}`, { method: "POST" }).then((r) => {
            if (r.ok) providers = providers.filter((x) => x !== p.key);
            rerender();
          });
        });
        row.append(un);
      }
    } else {
      row.append(providerAnchor(p, true));
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
