package polis.rewards

default eligible := false

eligible if {
  input.action != "political_agreement"
  input.review_state == "approved"
  input.period_total < input.monthly_cap
}
