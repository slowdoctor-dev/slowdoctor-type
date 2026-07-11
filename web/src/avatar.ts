// Generated avatar: 8×8 mirrored pattern × background hue, stored as
// "<8 hex chars>|<hue>". Pure logic (node-testable); DOM/painting lives in
// account.ts. Server-side counterpart: worker/src/auth.rs (random_avatar,
// valid_avatar).

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
