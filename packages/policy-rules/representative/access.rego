package polis.representative.access

# M-RA publish gate. A mandate-holder may publish commitments only when:
#   1. their identity is verified_official (§21);
#   2. their mandate_holder row is active;
#   3. their latest charter is accepted and signature-backed; and
#   4. the charter scope covers the commitment jurisdiction/process.
#
# Input contract:
#   input.identity_level == "verified_official"
#   input.mandate_holder.status == "active"
#   input.charter.status == "accepted"
#   input.charter.accepted_signing_request_id identifies input.signing_request
#   input.signing_request.status == "completed"
#   signed_artifact_id and proof_manifest_id agree across charter and request
#   input.requested_scope optional compatibility alias for mandate scope checks
#   input.commitment.jurisdiction/process optional when charter scope is absent/all
#   An absent charter scope covers all for Phase 1 skeleton compatibility.
default allow := false

allow if {
	input.identity_level == "verified_official"
	active_mandate_holder
	input.charter.status == "accepted"
	signature_backed
	scope_covers_commitment
	mandate_scope_covers_request
}

signature_backed if {
	input.charter.accepted_signing_request_id != ""
	input.signing_request.id == input.charter.accepted_signing_request_id
	input.signing_request.status == "completed"
	input.charter.signed_artifact_id != ""
	input.signing_request.signed_artifact_id == input.charter.signed_artifact_id
	input.charter.proof_manifest_id != ""
	input.signing_request.proof_manifest_id == input.charter.proof_manifest_id
}

active_mandate_holder if {
	input.mandate_holder.status == "active"
	not mandate_revoked
	not mandate_ended
}

mandate_revoked if {
	input.mandate_holder.revoked_at != null
}

mandate_ended if {
	input.mandate_holder.ended_at != null
}

scope_covers_commitment if {
	not input.charter.scope
}

scope_covers_commitment if {
	input.charter.scope == "all"
}

mandate_scope_covers_request if {
	not input.requested_scope
}

mandate_scope_covers_request if {
	input.mandate_holder.scope == "all"
}

mandate_scope_covers_request if {
	input.mandate_holder.scope == input.requested_scope
}

mandate_scope_covers_request if {
	input.mandate_holder.scopes[_] == "all"
}

mandate_scope_covers_request if {
	input.mandate_holder.scopes[_] == input.requested_scope
}

scope_covers_commitment if {
	jurisdiction_covered
	process_covered
}

jurisdiction_covered if {
	input.charter.scope.jurisdictions[_] == "all"
}

jurisdiction_covered if {
	input.charter.scope.jurisdictions[_] == input.commitment.jurisdiction
}

process_covered if {
	input.charter.scope.processes[_] == "all"
}

process_covered if {
	input.charter.scope.processes[_] == input.commitment.process
}
