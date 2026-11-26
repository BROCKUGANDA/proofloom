package example

import (
	"testing"

	core "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/core"
	reg "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/registry"
	rel "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/releases"
	att "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/attestations"
	pol "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/policies"
)

const (
	adminAddr = address("g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq")
	aliceAddr = address("g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	bobAddr   = address("g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
)

const digestA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2"
const digestB = "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2"

func TestConsumerGate(cur realm, t *testing.T) {
	// --- seed the PROTOCOL side (as if PROOFLOOM were already deployed) ---
	testing.SetRealm(testing.NewUserRealm(adminAddr))
	if !reg.IsInitialized() {
		reg.Init(cross(cur))
	}
	if !rel.Initialized() {
		rel.Init(cross(cur))
	}
	if !att.Initialized() {
		att.Init(cross(cur))
	}
	if !pol.Initialized() {
		pol.Init(cross(cur))
	}
	reg.GrantRegistrar(cross(cur), aliceAddr)
	testing.SetRealm(testing.NewUserRealm(aliceAddr))
	if !reg.HasProject("gate-proj") {
		reg.RegisterProject(cross(cur), "gate-proj", "Gated", "d", "repo", "service", "public")
	}
	rid := "gate-proj-1.0.0"
	if !rel.HasRelease(rid) {
		rel.CreateRelease(cross(cur), "gate-proj", "1.0.0", "abc1234", "main", "", "")
		rel.SetEvidence(cross(cur), rid, digestA)
		rel.MarkValidating(cross(cur), rid)
		rel.Approve(cross(cur), rid)
		rel.Publish(cross(cur), rid)
	}

	// --- initialize the CONSUMER realm ---
	testing.SetRealm(testing.NewUserRealm(adminAddr))
	Init(cross(cur))
	Watch(cross(cur), "gate-proj")

	// unverified release: gate closed
	ok, why := ReleaseGate(rid)
	if ok {
		t.Fatal("gate must stay closed without attestations")
	}
	if why == "" {
		t.Fatal("gate reason required")
	}

	// issuer attests build provenance: gate opens
	testing.SetRealm(testing.NewUserRealm(bobAddr))
	att.Issue(cross(cur), core.SubjectRelease, rid, core.AttestBuild, digestB, 0)

	ok, _ = ReleaseGate(rid)
	if !ok {
		t.Fatal("gate must open for verified release of watched project")
	}

	// revoke the release: gate closes again, verdict stays truthful
	testing.SetRealm(testing.NewUserRealm(aliceAddr))
	rel.Revoke(cross(cur), rid)
	ok, why = ReleaseGate(rid)
	if ok {
		t.Fatal("gate must close for revoked releases")
	}
	if why != "release verdict is REVOKED" {
		t.Fatalf("unexpected gate reason: %s", why)
	}

	// report renders
	testing.SetRealm(testing.NewUserRealm(adminAddr))
	rep := GateReport("gate-proj")
	if !contains(rep, "REVOKED") {
		t.Fatalf("report missing verdict: %s", rep)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
