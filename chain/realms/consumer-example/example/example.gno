// Package example is a third-party consumer realm for the PROOFLOOM
// protocol. It demonstrates that another application can consume
// PROOFLOOM's public verification interface WITHOUT registering anywhere,
// holding any authority, or importing any write-side realm.
//
// This is the composability proof required by the protocol: deploy this
// realm after PROOFLOOM is deployed, and it reads the public verify facade
// directly through Gno's interrealm mechanism.
//
// The consumer maintains its own allow-list of projects it trusts for its
// own purposes (a realistic integration pattern: a downstream distributor
// only ships releases that carry active security attestations).
package example

import (
	"strings"

	vf "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/verify"
)

var (
	// watchlist is this consumer's own policy: projects whose published
	// releases it is willing to consume.
	watchlist []string
	// curator is the address allowed to manage the watchlist (the consumer
	// realm's deployer).
	curator address
)

// Init records the curator. Called once at deployment.
func Init(cur realm) {
	if curator != "" {
		panic("consumer: already initialized")
	}
	curator = cur.Previous().Address()
}

// Watch adds a project to this consumer's watchlist. Curator only.
func Watch(cur realm, projectID string) {
	assertCurator(cur)
	for _, id := range watchlist {
		if id == projectID {
			return // idempotent
		}
	}
	watchlist = append(watchlist, projectID)
}

// Unwatch removes a project. Curator only.
func Unwatch(cur realm, projectID string) {
	assertCurator(cur)
	out := watchlist[:0]
	for _, id := range watchlist {
		if id != projectID {
			out = append(out, id)
		}
	}
	watchlist = out
}

func assertCurator(cur realm) {
	if cur.Previous().Address() != curator {
		panic("consumer: only the curator may manage the watchlist")
	}
}

// ReleaseGate decides whether this consumer would accept a release:
// the release must verify positively under PROOFLOOM's public interface
// and belong to a watched project. The gate is a pure function of
// protocol state — this realm stores no release data of its own.
func ReleaseGate(releaseID string) (bool, string) {
	v := vf.VerifyRelease(releaseID)
	if v.Verdict != vf.VerdictVerified {
		return false, "release verdict is " + v.Verdict
	}
	watched := false
	for _, id := range watchlist {
		if id == v.ProjectID {
			watched = true
			break
		}
	}
	if !watched {
		return false, "project not on watchlist"
	}
	return true, "verified release of watched project"
}

// GateReport renders a human-readable report of every release of a watched
// project, showing how a downstream UI can surface protocol verdicts.
func GateReport(projectID string) string {
	var b strings.Builder
	b.WriteString("PROOFLOOM consumer gate report for ")
	b.WriteString(projectID)
	b.WriteString("\n")
	releases := vf.ListReleaseIDsByProject(projectID)
	for _, rid := range releases {
		v := vf.VerifyRelease(rid)
		b.WriteString("- ")
		b.WriteString(rid)
		b.WriteString(" [")
		b.WriteString(v.Verdict)
		b.WriteString("] ")
		b.WriteString(v.Notes)
		b.WriteString("\n")
	}
	return b.String()
}

// Watchlist returns a copy of the current watchlist.
func Watchlist() []string {
	out := make([]string, len(watchlist))
	copy(out, watchlist)
	return out
}

// CuratorAddress returns the curator.
func CuratorAddress() address {
	return curator
}
