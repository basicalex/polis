# Pilot redaction governance — §30.10 criterion 3.
# Partner cannot suppress results outside pre-agreed privacy/security redactions.
# Redactions require: (1) non-empty reason, (2) project governance authority.

package polis.pilot

default allow_redaction := false

# Redaction requires: (1) non-empty reason, (2) actor is project governance (not partner alone).
allow_redaction if {
	input.reason != ""
	input.actor_authority == "project_governance"
}

# Deny if reason is missing.
deny_missing_reason if {
	input.action == "redact"
	input.reason == ""
}

# Deny if only partner requests (no project governance co-sign).
deny_partner_alone if {
	input.action == "redact"
	input.actor_authority == "partner"
}
