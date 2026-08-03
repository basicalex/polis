package polis.complaints

# Private municipal complaint authorization and lifecycle policy. The service
# enforces the same rules transactionally; this module is the reviewable policy contract.
default allow := false

complaint_jurisdiction := "jur-croatia-local"
complaint_institution := "inst-complaints-office"

owner if {
	input.actor.citizen_id == input.complaint.resident_citizen_id
}

resident_identity if {
	input.actor.identity_level == "verified_resident"
}

resident_identity if {
	input.actor.identity_level == "verified_official"
}

active_staff if {
	input.actor.identity_level == "staff"
	input.actor.mandate_holder_status == "active"
	input.actor.jurisdiction_id == complaint_jurisdiction
	input.actor.institution_id == complaint_institution
}

has_right(right) if {
	some i
	input.actor.rights[i] == right
}

decision_reader if {
	active_staff
	has_right("decide_complaint")
}

decision_reader if {
	active_staff
	has_right("decide_complaint_appeal")
}

allow if {
	input.action == "create"
	resident_identity
}

allow if {
	input.action == "read_mine"
	owner
}

allow if {
	input.action == "read_detail"
	owner
}

allow if {
	input.action == "read_detail"
	decision_reader
}

allow if {
	input.action == "read_queue"
	decision_reader
}

allow if {
	input.action == "assign"
	active_staff
	has_right("route_case_to_sector_office")
	input.complaint.status == "submitted"
	input.target.mandate_holder_status == "active"
	input.target.jurisdiction_id == complaint_jurisdiction
	input.target.institution_id == complaint_institution
	some i
	input.target.rights[i] == "decide_complaint"
}

allow if {
	input.action == "request_information"
	active_staff
	has_right("request_missing_identity_or_residence_evidence")
	input.complaint.status == "assigned"
	not input.pending_information_request
}

allow if {
	input.action == "respond_information"
	owner
	input.complaint.status == "awaiting_information"
	input.request_matches
	input.request_unanswered
}

allow if {
	input.action == "decide_initial"
	active_staff
	has_right("decide_complaint")
	input.complaint.status == "assigned"
	input.complaint.assigned_mandate_holder_id == input.actor.mandate_holder_id
	not input.pending_information_request
	not input.initial_decision_exists
}

allow if {
	input.action == "appeal"
	owner
	input.complaint.status == "decided"
	input.initial_decision_exists
	not input.appeal_exists
}

allow if {
	input.action == "decide_appeal"
	active_staff
	has_right("decide_complaint_appeal")
	input.complaint.status == "appealed"
	input.appeal_matches
	input.appeal_status == "filed"
	not input.appeal_decision_exists
	input.actor.mandate_holder_id != input.initial_decider.mandate_holder_id
	input.actor.citizen_id != input.initial_decider.citizen_id
}

allow if {
	input.action == "close"
	active_staff
	has_right("decide_complaint")
	input.complaint.status == "decided"
	input.complaint.assigned_mandate_holder_id == input.actor.mandate_holder_id
	input.initial_decision_exists
	not input.appeal_exists
}
