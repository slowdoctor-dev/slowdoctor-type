//! Pure auth/profile logic, factored out of the wasm-only worker crate for
//! the same reason `extract` exists: `cargo test` can't run worker code on
//! the host, and the sign-in state machine is the most security-sensitive
//! logic in the app — it must have tests. worker/src/auth.rs owns all I/O
//! (OAuth HTTP, D1, cookies on responses) and delegates decisions here.

/// What the OAuth callback should do, given who owns the incoming identity,
/// whether this is a link flow, and who is currently signed in.
#[derive(Debug, PartialEq, Eq)]
pub enum LoginAction {
    /// Identity already belongs to a different profile while linking → refuse.
    Conflict,
    /// Sign into the existing owner of this identity.
    SignIn(i64),
    /// Attach the new identity to the signed-in user.
    Link(i64),
    /// Link flow but the session died mid-flow — creating a fresh account
    /// here would silently split the user's profile in two.
    Expired,
    /// Brand-new identity with no link intent → create a user.
    CreateUser,
}

pub fn login_action(existing: Option<i64>, linking: bool, current: Option<i64>) -> LoginAction {
    match (existing, linking, current) {
        (Some(owner), true, Some(me)) if owner != me => LoginAction::Conflict,
        (Some(owner), _, _) => LoginAction::SignIn(owner),
        (None, true, Some(me)) => LoginAction::Link(me),
        (None, true, None) => LoginAction::Expired,
        (None, false, _) => LoginAction::CreateUser,
    }
}

/// Value of a named cookie inside a `Cookie:` request header.
pub fn cookie_value(header: &str, name: &str) -> Option<String> {
    for part in header.split(';') {
        if let Some((k, v)) = part.trim().split_once('=') {
            if k == name {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Avatar format `<8 hex chars>|<hue 0-359>` — 32 identicon pattern bits plus
/// a background hue. Rendering lives in web/src/avatar.ts.
pub fn valid_avatar(avatar: &str) -> bool {
    let Some((hex, hue)) = avatar.split_once('|') else {
        return false;
    };
    let hex_ok = hex.len() == 8 && hex.bytes().all(|b| b.is_ascii_hexdigit());
    let hue_ok = hue.parse::<u32>().map(|h| h < 360).unwrap_or(false);
    hex_ok && hue_ok
}

/// Deterministic avatar from 6 entropy bytes (the worker supplies randomness;
/// keeping this pure makes the format round-trip testable).
pub fn avatar_from_entropy(bytes: [u8; 6]) -> String {
    let hue = (u32::from(bytes[4]) << 8 | u32::from(bytes[5])) % 360;
    format!(
        "{:02x}{:02x}{:02x}{:02x}|{hue}",
        bytes[0], bytes[1], bytes[2], bytes[3]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use LoginAction::*;

    #[test]
    fn login_state_machine() {
        // plain sign-in with a known identity
        assert_eq!(login_action(Some(7), false, None), SignIn(7));
        // known identity while signed in as the same user (re-link) → sign-in
        assert_eq!(login_action(Some(7), true, Some(7)), SignIn(7));
        // linking an identity that belongs to someone else → conflict
        assert_eq!(login_action(Some(7), true, Some(9)), Conflict);
        // sign-in (not linking) with an identity owned elsewhere → that owner
        assert_eq!(login_action(Some(7), false, Some(9)), SignIn(7));
        // linking a fresh identity attaches to the current user
        assert_eq!(login_action(None, true, Some(9)), Link(9));
        // link flow with a dead session must NOT create an account
        assert_eq!(login_action(None, true, None), Expired);
        // fresh identity, fresh visitor → new account
        assert_eq!(login_action(None, false, None), CreateUser);
        // fresh identity while signed in but NOT linking → new separate account
        assert_eq!(login_action(None, false, Some(9)), CreateUser);
    }

    #[test]
    fn cookie_parsing() {
        let h = "a=1; sdtype_session=tok.en; b=x=y";
        assert_eq!(cookie_value(h, "sdtype_session").as_deref(), Some("tok.en"));
        assert_eq!(cookie_value(h, "a").as_deref(), Some("1"));
        assert_eq!(cookie_value(h, "b").as_deref(), Some("x=y"));
        assert_eq!(cookie_value(h, "missing"), None);
        assert_eq!(cookie_value("", "a"), None);
    }

    #[test]
    fn avatar_format() {
        assert!(valid_avatar("a1b2c3d4|359"));
        assert!(valid_avatar("00000000|0"));
        assert!(!valid_avatar("a1b2c3d4|360"));
        assert!(!valid_avatar("a1b2c3|30")); // short hex
        assert!(!valid_avatar("a1b2c3zz|30")); // non-hex
        assert!(!valid_avatar("a1b2c3d4")); // no hue
        assert!(!valid_avatar("⌨️|160")); // legacy emoji default never validates
        // entropy round-trip always yields a valid avatar
        assert!(valid_avatar(&avatar_from_entropy([0, 0, 0, 0, 0, 0])));
        assert!(valid_avatar(&avatar_from_entropy([255; 6])));
        assert_eq!(avatar_from_entropy([0xa1, 0xb2, 0xc3, 0xd4, 0, 100]), "a1b2c3d4|100");
    }
}
