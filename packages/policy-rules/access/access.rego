# SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
# SPDX-License-Identifier: AGPL-3.0-or-later

package polis.access
default allow := false
allow if { input.subject == input.owner }
allow if { input.grant.purpose != ""; input.grant.expires_at != "" }
