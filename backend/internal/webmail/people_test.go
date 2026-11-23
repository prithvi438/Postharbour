package webmail

import "testing"

func TestPersonTopics(t *testing.T) {
	if SubjectKey(" Re: re: Project A ") != "project a" || SubjectKey("Fwd: Project A") == "project a" {
		t.Fatal("incorrect subject normalization")
	}
	owner := "me@example.test"
	m := Summary{From: Address{Address: owner}, To: []Address{{Address: "Person@example.test"}}}
	if !WithPerson(m, owner, "person@example.test") || WithPerson(m, owner, "son@example.test") {
		t.Fatal("outgoing exact-address grouping failed")
	}
	m.From.Address = "sender@example.test"
	if WithPerson(m, owner, "person@example.test") || !WithPerson(m, owner, "sender@example.test") {
		t.Fatal("incoming must use sender")
	}
}
