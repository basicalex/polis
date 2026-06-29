package polis.representative.access

# M-RA publish gate (Phase 2 wiring; Phase 1 ships the tested skeleton only).
# A mandate-holder may publish only when ALL three hold:
#   1. their identity is verified_official (§21);
#   2. their mandate_holder row is active;
#   3. they hold an accepted charter.
default allow := false

allow if {
	input.identity_level == "verified_official"
	input.mandate_holder.status == "active"
	input.charter.status == "accepted"
}
