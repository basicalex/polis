package polis.contribute

# M6 §19/§21/§22 policy-as-code. The contribution-service enforces equivalent
# checks in TS; this Rego is the authoritative decision spec tested via opa eval.
default allow_submit := false
default allow_review := false
default auto_publish := false

# §21: submission requires a known non-anonymous identity level.
allow_submit if { input.identity_level == "casual" }
allow_submit if { input.identity_level == "verified" }
allow_submit if { input.identity_level == "enrolled" }
allow_submit if { input.identity_level == "staff" }

# §19: approval requires the reviewer role.
allow_review if { input.role == "reviewer" }

# §22/ADR-007: political_agreement contributions are never auto-published,
# even when approved. object.get treats a missing class as non-political.
auto_publish if {
	object.get(input, "contribution_class", "") != "political_agreement"
	input.review_state == "approved"
}
