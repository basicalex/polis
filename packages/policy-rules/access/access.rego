package polis.access
default allow := false
allow if { input.subject == input.owner }
allow if { input.grant.purpose != ""; input.grant.expires_at != "" }
