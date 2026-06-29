package polis.representative.status

# M-RA terminal-status gate (Phase 2 wiring; Phase 1 ships the tested skeleton
# only). A terminal commitment status (delivered|partial|not_delivered) requires
# an approved resolution claim — the office-holder cannot self-assign `delivered`.
default allow_terminal := false

allow_terminal if {
	input.resolution_review_state == "approved"
}
