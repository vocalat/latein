import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";
import { VERB_FRAMES } from "../latin-language-data.js";

const entry = (lemma, deutsch, pos = "n") => ({
  lemma,
  latein: lemma,
  deutsch,
  meanings: [deutsch],
  pos,
  source: "fallback"
});

const word = (token, lexicalEntry, morphology) => ({
  token,
  normalized: token.toLocaleLowerCase("la"),
  status: "fallback",
  entries: [lexicalEntry],
  morphology: [morphology],
  length: 1
});

const noun = (token, lemma, deutsch, grammaticalCase, number = "singular", gender = "m") =>
  word(token, entry(lemma, deutsch), { part: "n", case: grammaticalCase, number, gender });

const proper = (token, grammaticalCase = "nominative") =>
  word(token, entry(token, token, "proper"), {
    part: "proper",
    case: grammaticalCase,
    number: "singular",
    gender: "m"
  });

const pronoun = (token, lemma, grammaticalCase, number = "singular") =>
  word(token, entry(lemma, "", "pron"), { part: "pron", case: grammaticalCase, number, gender: "c" });

const finite = (token, lemma, deutsch, options = {}) =>
  word(token, entry(lemma, deutsch, "v"), {
    part: "v",
    person: options.person || 3,
    number: options.number || "singular",
    tense: options.tense || "present",
    mood: options.mood || "indicative",
    voice: options.voice || "active"
  });

const infinitive = (token, lemma, deutsch) =>
  word(token, entry(lemma, deutsch, "v"), {
    part: "v",
    mood: "infinitive",
    tense: "present",
    voice: "active"
  });

const conjunction = token =>
  word(token, entry(token, token, "conj"), { part: "conj" });

test("impersonal modal valency promotes Latin case arguments to German subjects", () => {
  const oportetWords = [
    pronoun("te", "tu", "accusative"),
    infinitive("venire", "venio", "kommen"),
    finite("oportet", "oportet", "müssen")
  ];
  const licetWords = [
    pronoun("mihi", "ego", "dative"),
    finite("licet", "licet", "dürfen"),
    infinitive("ire", "eo", "gehen")
  ];
  const oportetResults = permutations(oportetWords).map(words => translateLatinSyntax(words));
  const licetResults = permutations(licetWords).map(words => translateLatinSyntax(words));

  assert.deepEqual([...new Set(oportetResults.map(result => result.text))], ["Du musst kommen."]);
  assert.deepEqual([...new Set(licetResults.map(result => result.text))], ["Ich darf gehen."]);
  assert.ok(oportetResults.every(result => result.pipeline.grammar.constructions.some(item => item.type === "impersonal")));
  assert.ok(licetResults.every(result => result.pipeline.grammar.constructions.some(item => item.type === "impersonal")));
});

test("impersonal esse idioms use the same productive controller strategy", () => {
  const necessary = translateLatinSyntax([
    word("necesse", entry("necesse", "notwendig", "adj"), { part: "adj" }),
    finite("est", "sum", "sein"),
    pronoun("nobis", "nos", "dative", "plural"),
    infinitive("pugnare", "pugno", "kämpfen")
  ]);
  const custom = translateLatinSyntax([
    noun("Romanis", "Romanus", "der Römer", "dative", "plural"),
    noun("mos", "mos", "die Sitte", "nominative"),
    finite("est", "sum", "sein"),
    infinitive("pugnare", "pugno", "kämpfen")
  ]);

  assert.equal(necessary.text, "Wir müssen kämpfen.");
  assert.equal(custom.text, "Die Römer pflegen zu kämpfen.");
});

test("dummy-subject frames do not invent a masculine Latin subject", () => {
  const pleasing = translateLatinSyntax([
    pronoun("mihi", "ego", "dative"),
    finite("placet", "placet", "gefallen"),
    infinitive("ire", "eo", "gehen")
  ]);
  const established = translateLatinSyntax([
    finite("constat", "constat", "feststehen"),
    noun("virum", "vir", "der Mann", "accusative"),
    infinitive("venire", "venio", "kommen")
  ]);

  assert.equal(pleasing.text, "Es gefällt mir zu gehen.");
  assert.equal(established.text, "Es steht fest, dass der Mann kommt.");
});

test("potentially impersonal verbs keep an explicit nominative subject", () => {
  const result = translateLatinSyntax([
    noun("Puellae", "puella", "das Mädchen", "nominative", "plural", "f"),
    pronoun("mihi", "ego", "dative"),
    finite("placent", "placeo", "gefallen", { number: "plural" })
  ]);

  assert.equal(result.text, "Die Mädchen gefallen mir.");
  assert.ok(!result.pipeline.grammar.constructions.some(item => item.type === "impersonal"));
});

test("NcI chooses its German control verb from valency instead of one global paraphrase", () => {
  const result = translateLatinSyntax([
    proper("Marcus"),
    infinitive("venire", "venio", "kommen"),
    finite("videtur", "video", "sehen", { voice: "passive" })
  ]);

  assert.equal(result.text, "Marcus scheint zu kommen.");
  assert.ok(result.pipeline.grammar.constructions.some(item => item.type === "nci"));
});

test("verb-governed ne and quin clauses are interpreted through central complement frames", () => {
  const fear = translateLatinSyntax([
    finite("timeo", "timeo", "fürchten", { person: 1 }),
    conjunction("ne"),
    noun("amicus", "amicus", "der Freund", "nominative"),
    finite("veniat", "venio", "kommen", { mood: "subjunctive" })
  ]);
  const doubt = translateLatinSyntax([
    finite("dubito", "dubito", "zweifeln", { person: 1 }),
    word("non", entry("non", "nicht", "adv"), { part: "adv" }),
    conjunction("quin"),
    noun("amicus", "amicus", "der Freund", "nominative"),
    finite("veniat", "venio", "kommen", { mood: "subjunctive" })
  ]);

  assert.equal(fear.text, "Ich fürchte, dass der Freund kommt.");
  assert.equal(doubt.text, "Ich zweifle nicht, dass der Freund kommt.");
  assert.equal(fear.pipeline.grammar.clauses.find(clause => clause.marker === "ne")?.type, "fear-content");
  assert.equal(doubt.pipeline.grammar.clauses.find(clause => clause.marker === "quin")?.type, "quin-content");
});

test("fronted complement clauses still find their governing verb from the whole sentence", () => {
  const fronted = translateLatinSyntax([
    conjunction("ne"),
    noun("amicus", "amicus", "der Freund", "nominative"),
    finite("veniat", "venio", "kommen", { mood: "subjunctive" }),
    finite("timeo", "timeo", "fürchten", { person: 1 })
  ]);

  assert.equal(fronted.pipeline.grammar.clauses.find(clause => clause.marker === "ne")?.type, "fear-content");
  assert.match(fronted.text, /^Dass der Freund kommt,/u);
  assert.doesNotMatch(fronted.text, /damit nicht/iu);
});

test("the central frame records productive behavior rather than sentence strings", () => {
  assert.deepEqual(
    {
      cases: VERB_FRAMES.oportet.cases,
      strategy: VERB_FRAMES.oportet.impersonal.strategy,
      role: VERB_FRAMES.oportet.impersonal.controllerRole
    },
    { cases: ["accusative"], strategy: "promote-controller", role: "directObject" }
  );
  assert.equal(VERB_FRAMES.timeo.clauseComplements.ne.germanConnector, "dass");
  assert.equal(VERB_FRAMES.timeo.clauseComplements.ne.semanticNegation, undefined);
});

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
      .map(rest => [value, ...rest])
  );
}
