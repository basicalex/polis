package polis.polis_access

# M2 §13: creating a Polis conversation is a service-level action. The public
# BFF does NOT proxy the create route; this policy documents + tests the trust
# boundary. Real IAM-gated creation (user-facing) lands in M6/M8.
default allow := false

allow if {
  input.actor.type == "service"
  input.action == "create_conversation"
}
