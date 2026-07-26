import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

/*
 * These synthetic records exercise constructions rather than stored passages.
 * Each test supplies ordinary lexical and morphological information directly,
 * so a regression cannot be hidden by OCR or by a sentence-specific lookup.
 */

const entry = (lemma, german, pos = "n") => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source: "fallback"
});

function word(token, lemma, german, pos, morphology) {
  const lexicalEntry = entry(lemma, german, pos);
  const analysis = { dictionaryLemma: lemma, ...morphology };
  return {
    token,
    normalized: normalizeLatin(token),
    status: "fallback",
    entries: [lexicalEntry],
    morphology: [analysis],
    morphologyCandidates: [{ entry: lexicalEntry, morphology: analysis }],
    length: 1
  };
}

const noun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  word(token, lemma, german, "n", { part: "n", case: grammaticalCase, number, gender });

const pronoun = (token, lemma, german, grammaticalCase, number = "singular", gender = "c", extra = {}) =>
  word(token, lemma, german, "pron", {
    part: "pron",
    case: grammaticalCase,
    number,
    gender,
    ...extra
  });

const finite = (token, lemma, german, options = {}) =>
  word(token, lemma, german, "v", {
    part: "v",
    mood: "indicative",
    tense: "present",
    voice: "active",
    person: 3,
    number: "singular",
    ...options
  });

const infinitive = (token, lemma, german, tense = "present", voice = "active") =>
  word(token, lemma, german, "v", {
    part: "v",
    mood: "infinitive",
    tense,
    voice
  });

const participle = (token, lemma, german, grammaticalCase, number, gender, tense, voice, extra = {}) =>
  word(token, lemma, german, "v", {
    part: "ppa",
    mood: "participle",
    case: grammaticalCase,
    number,
    gender,
    tense,
    voice,
    ...extra
  });

const preposition = (token, german) =>
  word(token, normalizeLatin(token), german, "prep", { part: "prep" });

const proper = token =>
  word(token, token, token, "proper", {
    part: "proper",
    case: "nominative",
    number: "singular",
    gender: "m"
  });

function translate(words) {
  return translateLatinSyntax(words);
}

function construction(result, type) {
  return result.pipeline.grammar.constructions.find(item => item.type === type);
}

test("personal and impersonal gerundives use the local dative agent without a dummy object", () => {
  const personal = translate([
    pronoun("tibi", "tu", "du", "dative", "singular"),
    noun("liber", "liber", "das Buch", "nominative"),
    participle("legendus", "lego", "lesen", "nominative", "singular", "m", "future", "passive", {
      gerundiveCandidate: true,
      participleType: "future-passive"
    }),
    finite("est", "sum", "sein")
  ]);
  const impersonal = translate([
    pronoun("nobis", "nos", "wir", "dative", "plural"),
    participle("eundum", "eo", "gehen", "nominative", "singular", "n", "future", "passive", {
      gerundiveCandidate: true,
      participleType: "future-passive"
    }),
    finite("est", "sum", "sein")
  ]);

  assert.equal(personal.text, "Du musst das Buch lesen.");
  assert.equal(construction(personal, "gerundive-obligation")?.agentIndex, 0);
  assert.equal(impersonal.text, "Wir müssen gehen.");
  assert.equal(construction(impersonal, "gerundive-obligation")?.impersonal, true);
  assert.doesNotMatch(impersonal.text, /\bes gehen\b/iu);
});

test("an accusative participle keeps the matrix subject and remains inside the object phrase", () => {
  const result = translate([
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    noun("puerum", "puer", "der Junge", "accusative"),
    participle("currentem", "curro", "laufen", "accusative", "singular", "m", "present", "active"),
    finite("videt", "video", "sehen")
  ]);

  assert.equal(result.text, "Das Mädchen sieht den laufenden Jungen.");
  assert.equal(construction(result, "present-participle")?.antecedentIndex, 1);
  assert.doesNotMatch(result.text, /^Der Junge\b/u);
});

test("relative clauses preserve the antecedent's matrix case", () => {
  const result = translate([
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    noun("amico", "amicus", "der Freund", "dative"),
    pronoun("qui", "qui", "der", "nominative", "singular", "m", { pronounKind: "relative" }),
    finite("laborat", "laboro", "arbeiten"),
    noun("librum", "liber", "das Buch", "accusative"),
    finite("dat", "do", "geben")
  ]);

  assert.match(result.text, /^Das Mädchen\b/u, result.text);
  assert.match(result.text, /\bdem Freund, der arbeitet\b/u, result.text);
  assert.doesNotMatch(result.text, /\bder Freund, der arbeitet\b/u, result.text);
});

test("a preposition governing a relative pronoun stays in the relative clause", () => {
  const result = translate([
    noun("amicus", "amicus", "der Freund", "nominative"),
    preposition("cum", "mit"),
    pronoun("quo", "qui", "der", "ablative", "singular", "m", { pronounKind: "relative" }),
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    finite("ambulat", "ambulo", "gehen"),
    finite("venit", "venio", "kommen")
  ]);

  assert.match(result.text, /^Der Freund, mit dem das Mädchen geht, kommt\.$/u, result.text);
  assert.doesNotMatch(result.text, /\bcum\b/iu, result.text);
});

test("an AcI with future active participle and esse generates a German future clause", () => {
  const future = translate([
    proper("Caesar"),
    finite("dicit", "dico", "sagen"),
    noun("milites", "miles", "der Soldat", "accusative", "plural"),
    participle("venturos", "venio", "kommen", "accusative", "plural", "m", "future", "active", {
      participleType: "future-active"
    }),
    infinitive("esse", "sum", "sein")
  ]);

  assert.equal(future.text, "Caesar sagt, dass die Soldaten kommen werden.");
  assert.equal(construction(future, "aci")?.predicates?.[0]?.participleIndex, 3);
});

test("an AcI with perfect passive participle and esse generates an anterior passive clause", () => {
  const perfectPassive = translate([
    proper("Caesar"),
    finite("dicit", "dico", "sagen"),
    noun("milites", "miles", "der Soldat", "accusative", "plural"),
    participle("victos", "vinco", "besiegen", "accusative", "plural", "m", "perfect", "passive", {
      participleType: "perfect-passive"
    }),
    infinitive("esse", "sum", "sein")
  ]);

  assert.equal(perfectPassive.text, "Caesar sagt, dass die Soldaten besiegt worden sind.");
  assert.equal(construction(perfectPassive, "aci")?.predicates?.[0]?.participleIndex, 3);
});

test("an AcI with a direct passive infinitive keeps the embedded passive voice", () => {
  const directPassive = translate([
    proper("Caesar"),
    finite("dicit", "dico", "sagen"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    infinitive("capi", "capio", "erobern", "present", "passive")
  ]);

  assert.equal(directPassive.text, "Caesar sagt, dass die Stadt erobert wird.");
});

function normalizeLatin(value) {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/\p{M}/gu, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}
