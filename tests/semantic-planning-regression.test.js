import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const lexeme = (lemma, german, pos = "n", source = "fallback", extra = {}) => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source,
  ...extra
});

function word(token, entries, morphology) {
  const lexicalEntries = Array.isArray(entries) ? entries : [entries];
  const analyses = lexicalEntries.map(entry => ({
    entry,
    morphology: { dictionaryLemma: entry.lemma, ...morphology }
  }));
  return {
    token,
    normalized: token.toLocaleLowerCase("la"),
    status: "fallback",
    entries: lexicalEntries,
    morphology: analyses.map(candidate => candidate.morphology),
    morphologyCandidates: analyses,
    length: 1
  };
}

const noun = (token, lemma, german, grammaticalCase, {
  number = "singular",
  gender = "m",
  source = "fallback",
  semanticClass = null
} = {}) => word(token, lexeme(lemma, german, "n", source, { semanticClass }), {
  part: "n",
  case: grammaticalCase,
  number,
  gender
});

const finite = (token, lemma, meanings) => word(
  token,
  meanings.map(({ german, source = "fallback" }) => lexeme(lemma, german, "v", source)),
  {
    part: "v",
    mood: "indicative",
    tense: "present",
    voice: "active",
    person: 3,
    number: "singular"
  }
);

const conjunction = (token, german) =>
  word(token, lexeme(token, german, "conj"), { part: "conj" });

const subject = () => noun("vir", "vir", "der Mann", "nominative");

function semanticVerb(result, lemma) {
  return result.pipeline.semantics.words.find(item =>
    item.lemma === lemma && item.morphology?.part === "v"
  );
}

function permutations(subjectWord, objectWord, verbWord) {
  return [
    [subjectWord(), objectWord(), verbWord()],
    [objectWord(), verbWord(), subjectWord()],
    [verbWord(), subjectWord(), objectWord()]
  ];
}

test("a context-compatible book meaning wins over a fallback meaning", () => {
  const result = translateLatinSyntax([
    noun("servus", "servus", "der Sklave", "nominative"),
    noun("sarcinam", "sarcina", "das Gepäck", "accusative", { gender: "n" }),
    finite("portat", "porto", [
      { german: "tragen", source: "book" },
      { german: "bringen", source: "fallback" }
    ])
  ]);
  const predicate = semanticVerb(result, "porto");

  assert.equal(result.text, "Der Sklave trägt das Gepäck.");
  assert.equal(predicate.sense, "tragen");
  assert.equal(predicate.entry?.source, "book");
  assert.match(predicate.semanticSelection.candidates[0].evidence.join(" "), /compatible-book-priority/);
  assert.deepEqual(
    result.lexicalSources.find(item => item.lemma === "porto"),
    { token: "portat", lemma: "porto", source: "book", sense: "tragen" }
  );
});

test("dependency collocations choose meanings independently of Latin word order", () => {
  const cases = [
    {
      lemma: "lego",
      collocation: "lego-text",
      sense: "lesen",
      text: "Der Mann liest das Buch.",
      object: () => noun("librum", "liber", "das Buch", "accusative", { gender: "n", semanticClass: "text" }),
      verb: () => finite("legit", "lego", [
        { german: "lesen", source: "book" },
        { german: "pflücken" }
      ])
    },
    {
      lemma: "lego",
      collocation: "lego-harvest",
      sense: "pflücken",
      text: "Der Mann pflückt die Rose.",
      object: () => noun("rosam", "rosa", "die Rose", "accusative", { gender: "f", semanticClass: "plant" }),
      verb: () => finite("legit", "lego", [
        { german: "lesen", source: "book" },
        { german: "pflücken" }
      ])
    },
    {
      lemma: "colo",
      collocation: "colo-divine",
      sense: "verehren",
      text: "Der Mann verehrt den Gott.",
      object: () => noun("deum", "deus", "der Gott", "accusative", { semanticClass: "divine" }),
      verb: () => finite("colit", "colo", [
        { german: "pflegen", source: "book" },
        { german: "verehren" },
        { german: "bebauen" }
      ])
    },
    {
      lemma: "colo",
      collocation: "colo-land",
      sense: "bebauen",
      text: "Der Mann bebaut den Acker.",
      object: () => noun("agrum", "ager", "der Acker", "accusative", { semanticClass: "land" }),
      verb: () => finite("colit", "colo", [
        { german: "pflegen", source: "book" },
        { german: "verehren" },
        { german: "bebauen" }
      ])
    },
    {
      lemma: "duco",
      collocation: "duco-group",
      sense: "führen",
      text: "Der Mann führt das Heer.",
      object: () => noun("exercitum", "exercitus", "das Heer", "accusative", { gender: "n", semanticClass: "military" }),
      verb: () => finite("ducit", "duco", [
        { german: "führen", source: "book" },
        { german: "heiraten" }
      ])
    },
    {
      lemma: "duco",
      collocation: "duco-spouse",
      sense: "heiraten",
      text: "Der Mann heiratet eine Ehefrau.",
      object: () => noun("uxorem", "uxor", "die Ehefrau", "accusative", { gender: "f", semanticClass: "spouse" }),
      verb: () => finite("ducit", "duco", [
        { german: "führen", source: "book" },
        { german: "heiraten" }
      ])
    }
  ];

  for (const sample of cases) {
    const results = permutations(subject, sample.object, sample.verb)
      .map(words => translateLatinSyntax(words));
    assert.deepEqual(
      results.map(result => result.text),
      Array(results.length).fill(sample.text),
      sample.collocation
    );
    for (const result of results) {
      const predicate = semanticVerb(result, sample.lemma);
      assert.equal(predicate.sense, sample.sense, sample.collocation);
      assert.equal(predicate.semanticSelection.collocation?.id, sample.collocation);
      assert.match(
        predicate.semanticSelection.candidates[0].evidence.join(" "),
        new RegExp(`collocation:${sample.collocation}`)
      );
    }
  }
});

test("idiom matching is limited to one parsed clause", () => {
  const idiomaticOrders = [
    [
      noun("puer", "puer", "das Kind", "nominative"),
      noun("gratias", "gratia", "der Dank", "accusative", { number: "plural", gender: "f" }),
      finite("agit", "ago", [{ german: "tun" }])
    ],
    [
      noun("gratias", "gratia", "der Dank", "accusative", { number: "plural", gender: "f" }),
      finite("agit", "ago", [{ german: "tun" }]),
      noun("puer", "puer", "das Kind", "nominative")
    ]
  ];

  for (const words of idiomaticOrders) {
    const result = translateLatinSyntax(words);
    assert.equal(result.text, "Das Kind dankt.");
    assert.equal(
      result.pipeline.semantics.constructions.some(item => item.id === "gratias-agere"),
      true
    );
  }

  const separated = translateLatinSyntax([
    noun("gratia", "gratia", "der Dank", "nominative", { gender: "f" }),
    finite("venit", "venio", [{ german: "kommen" }]),
    conjunction("et", "und"),
    noun("puer", "puer", "das Kind", "nominative"),
    finite("agit", "ago", [{ german: "tun" }])
  ]);

  assert.equal(separated.pipeline.semantics.clauses.length, 2);
  assert.equal(
    separated.pipeline.semantics.constructions.some(item => item.id === "gratias-agere"),
    false
  );
  assert.doesNotMatch(separated.text, /\bdankt\b/iu);
});

test("the public pipeline exposes semantic frames and a German sentence plan", () => {
  const result = translateLatinSyntax([
    noun("vir", "vir", "der Mann", "nominative"),
    noun("librum", "liber", "das Buch", "accusative", { gender: "n", semanticClass: "text" }),
    finite("legit", "lego", [
      { german: "lesen", source: "book" },
      { german: "pflücken" }
    ])
  ]);
  const semantics = result.pipeline.semantics;
  const plan = result.pipeline.germanPlan;

  assert.equal(semantics.semanticLayerComplete, true);
  assert.equal(semantics.semanticFrames.length, 1);
  assert.equal(semantics.semanticFrames[0].predicate.lemma, "lego");
  assert.equal(semantics.semanticFrames[0].predicate.sense, "lesen");
  assert.deepEqual(
    semantics.semanticFrames[0].arguments.subject.map(item => item.lemma),
    ["vir"]
  );
  assert.deepEqual(
    semantics.semanticFrames[0].arguments.directObject.map(item => item.lemma),
    ["liber"]
  );

  assert.equal(plan.type, "german-sentence-plan");
  assert.equal(plan.strategy, "clause");
  assert.equal(plan.semantics, semantics);
  assert.equal(plan.clauses.length, 1);
  assert.equal(plan.clauses[0].semanticFrameId, semantics.semanticFrames[0].id);
  assert.equal(plan.clauses[0].predicate.lemma, "lesen");
  assert.deepEqual(plan.clauses[0].germanRoles.subjectIndexes, [0]);
  assert.deepEqual(plan.clauses[0].germanRoles.directObjectIndexes, [1]);
});
