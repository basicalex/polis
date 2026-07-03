package polis.identity.access

# M10: OIDC private flows require a verified email claim. Stub mode bypasses
# this gate (dev magic-link does not assert email_verified). Enforced in code
# at POST /internal/identity/callback; this module is the authoritative spec,
# tested with real `opa eval`.
default allow := false

allow if {
	input.mode == "stub"
}

allow if {
	input.mode == "oidc"
	input.email_verified == true
}
