# SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
# SPDX-License-Identifier: AGPL-3.0-or-later

package polis.polis_access

# M2 §13: creating a Polis conversation is a service-level action. The public
# BFF does NOT proxy the create route; this policy documents + tests the trust
# boundary. Real IAM-gated creation (user-facing) lands in M6/M8.
default allow := false

allow if {
  input.actor.type == "service"
  input.action == "create_conversation"
}
