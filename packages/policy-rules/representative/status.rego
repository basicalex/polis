package polis.representative.status

# M-RA terminal-status gate. Officials file resolution claims; only an approved
# review may adjudicate a terminal commitment status. Overdue is not caller
# discretionary: it is read-time/system-derived from due_at and latest status.
#
# Terminal input contract:
#   input.requested_status in {"delivered", "partial", "not_delivered"}
#   input.resolution_review_state == "approved"
#   input.resolution_claim_id is present and non-empty
#   input.decided_by must not equal input.mandate_holder.citizen_id when present
#
# Overdue input contract:
#   input.system_derived == true
#   input.latest_status in {"proposed", "in_progress"}
#   input.due_at <= input.now
default allow_terminal := false
default allow_overdue := false

terminal_status if {
	input.requested_status == "delivered"
}

terminal_status if {
	input.requested_status == "partial"
}

terminal_status if {
	input.requested_status == "not_delivered"
}

active_status if {
	input.latest_status == "proposed"
}

active_status if {
	input.latest_status == "in_progress"
}

approved_resolution_review if {
	input.resolution_review_state == "approved"
}

has_resolution_claim_id if {
	input.resolution_claim_id != ""
}

caller_self_assigned if {
	input.decided_by == input.mandate_holder.citizen_id
}

caller_self_assigned if {
	input.decided_by == input.commitment.official_id
}

caller_self_assigned if {
	input.decided_by == input.commitment.mandate_holder_id
}

caller_self_assigned if {
	not input.decided_by
	input.caller_id == input.commitment.official_id
}

caller_self_assigned if {
	not input.decided_by
	input.caller_id == input.commitment.mandate_holder_id
}

allow_terminal if {
	terminal_status
	approved_resolution_review
	has_resolution_claim_id
	not caller_self_assigned
}

allow_overdue if {
	input.system_derived == true
	active_status
	input.due_at <= input.now
}
