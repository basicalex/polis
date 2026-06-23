package polis.vault

default allow := false

# §16.4 access rules: active grant, started, not expired, not revoked.
allow if {
  input.grant.status == "active"
  input.grant.revoked_at == null
  input.now >= input.grant.starts_at
  input.grant.expires_at == null
}

allow if {
  input.grant.status == "active"
  input.grant.revoked_at == null
  input.now >= input.grant.starts_at
  input.now < input.grant.expires_at
}

default proof_only_no_bytes := false
# proof_only grants never yield document bytes regardless of allow.
proof_only_no_bytes if {
  input.grant.scope == "proof_only"
}
