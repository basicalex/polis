package polis.ai

default publish := false

# §17 / ADR-005 publish gate — an AI output may only be published when it is
# grounded in approved evidence, the prompt was not an injection attempt, and a
# human review has approved it. All four conditions are ANDed.
publish if {
	input.has_citations
	input.has_approved_sources
	not input.injection_detected
	input.review_state == "approved"
}
