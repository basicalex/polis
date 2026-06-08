package polis.ai
default publish := false
publish if { input.has_citations; input.review_state == "approved" }
