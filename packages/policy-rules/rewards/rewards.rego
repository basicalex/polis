# SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
# SPDX-License-Identifier: AGPL-3.0-or-later

package polis.rewards

default eligible := false

eligible if {
  input.action != "political_agreement"
  input.review_state == "approved"
  input.period_total < input.monthly_cap
}
