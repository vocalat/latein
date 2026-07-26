/**
 * Stage between Latin semantics and German surface realisation.
 *
 * The plan stores German roles, target cases, predicate choice and clause
 * attachment independently of Latin token order.  The generator may inflect
 * and linearise these records, but it must not reinterpret Latin valency.
 */

import {
  INTERROGATIVE_FORMS,
  LATIN_IDIOMS,
  VERB_FRAMES
} from "./latin-language-data.js";
import { isFinite } from "./latin-analysis.js";

const POLAR_QUESTION_PARTICLES = new Set(["ne", "nonne", "num", "utrum"]);

export function buildGermanSentencePlan(semantics, options = {}) {
  if (!semantics?.words?.length) {
    return {
      type: "german-sentence-plan",
      strategy: "empty",
      sentenceType: "statement",
      semantics,
      clauses: [],
      options
    };
  }

  const words = semantics.words;
  const constructions = semantics.constructions || [];
  const rootStatement = constructions.find(item =>
    ["aci", "nci"].includes(item.type) && isFinite(words[item.governingIndex])
  );
  const strategy = chooseSentenceStrategy(semantics, rootStatement);
  const semanticFrames = new Map((semantics.semanticFrames || []).map(frame => [frame.clauseId, frame]));

  return {
    type: "german-sentence-plan",
    strategy,
    sentenceType: semantics.type || "statement",
    rootConstruction: rootStatement || constructionForStrategy(constructions, strategy),
    clauseOrder: (semantics.clauses || []).map(clause => clause.id),
    clauses: (semantics.clauses || []).map(clause =>
      buildGermanClausePlan(clause, semantics, semanticFrames.get(clause.id))
    ),
    semantics,
    options
  };
}

function buildGermanClausePlan(clause, semantics, semanticFrame) {
  const words = semantics.words;
  const finite = clause.headIndex == null ? null : words[clause.headIndex];
  const idiom = (semantics.constructions || []).find(item =>
    item.type === "idiom" && item.headIndex === finite?.index
  );
  const idiomFrame = idiom ? LATIN_IDIOMS.find(item => item.id === idiom.id) : null;
  const impersonal = (semantics.constructions || []).find(item =>
    item.type === "impersonal" && item.governingIndex === finite?.index
  );
  const frame = VERB_FRAMES[finite?.lemma] || null;
  const controllerRole = impersonal?.strategy === "promote-controller"
    ? impersonal.controllerRole
    : null;
  const subjectRole = controllerRole || idiomFrame?.subjectRole || "subject";
  const directRole = idiomFrame?.directObjectRole || "directObject";
  const collocation = semanticFrame?.collocation || finite?.semanticSelection?.collocation || null;
  const subjectIndexes = [...(clause.roles?.[subjectRole] || [])];
  const directObjectIndexes = (clause.roles?.[directRole] || [])
    .filter(index => !subjectIndexes.includes(index));
  const indirectObjectIndexes = (clause.roles?.indirectObject || [])
    .filter(index => !subjectIndexes.includes(index));

  return {
    type: "german-clause-plan",
    id: `german-${clause.id}`,
    clauseId: clause.id,
    clauseType: clause.type,
    sourceHeadIndex: finite?.index ?? null,
    predicate: finite ? {
      lemma: finite.sense || frame?.defaultSense || "",
      sourceLemma: finite.lemma,
      tense: finite.morphology?.tense || "present",
      mood: finite.morphology?.mood || "indicative",
      voice: finite.morphology?.voice || "active"
    } : null,
    germanRoles: {
      subjectIndexes,
      subjectStrategy: impersonal?.strategy || "ordinary",
      fallbackSubject: impersonal?.fallbackSubject || impersonal?.germanSubject || null,
      directObjectIndexes,
      indirectObjectIndexes,
      genitiveIndexes: [...(clause.roles?.genitive || [])],
      ablativeIndexes: [...(clause.roles?.ablative || [])],
      adverbialIndexes: [...(clause.roles?.adverbial || [])],
      prepositional: (clause.roles?.prepositional || []).map(item => ({ ...item }))
    },
    directObject: {
      role: directRole,
      germanCase: idiomFrame?.germanDirectCase || frame?.germanDirectCase || "accusative",
      preposition: frame?.germanDirectPreposition || null,
      indefinite: Boolean(idiomFrame?.directObjectIndefinite || collocation?.directObjectIndefinite)
    },
    ablative: {
      germanCase: frame?.germanAblativeCase || null,
      preposition: frame?.germanAblativePreposition || null
    },
    idiom: idiom ? {
      id: idiom.id,
      german: idiom.german,
      indexes: [...(idiom.indexes || [])]
    } : null,
    impersonal: impersonal ? { ...impersonal } : null,
    collocation,
    semanticFrameId: semanticFrame?.id || null,
    connector: clause.germanConnector || null,
    negated: Boolean(clause.semanticNegation)
      || clause.tokenIndexes.some(index => ["non", "haud"].includes(words[index]?.normalized)),
    subordinate: !["main", "coordinate"].includes(clause.type)
  };
}

function chooseSentenceStrategy(semantics, rootStatement) {
  const constructions = semantics.constructions || [];
  const has = type => constructions.some(item => item.type === type);
  const hasOpenQuestion = semantics.words.some(word =>
    INTERROGATIVE_FORMS.has(word.normalized) && !POLAR_QUESTION_PARTICLES.has(word.normalized)
  );

  if (semantics.type === "question" && semantics.clauses.length === 1) {
    return hasOpenQuestion ? "direct-question" : "polar-question";
  }
  if (has("indirect-question") || semantics.clauses.some(clause => clause.type === "indirect-question")) return "indirect-question";
  if (has("free-relative")) return "free-relative";
  if (rootStatement?.type === "aci") return "aci";
  if (rootStatement?.type === "nci") return "nci";
  for (const type of [
    "infinitive-command", "gerundive-obligation", "relative-clause",
    "ablative-absolute", "present-participle", "perfect-passive-participle",
    "future-participle", "participial-phrase"
  ]) {
    if (has(type)) return type;
  }
  if (semantics.clauses[0]?.type === "prohibition"
    || semantics.clauses.length === 1 && semantics.words[0]?.normalized === "ne") {
    return "prohibition";
  }
  return semantics.clauses.length > 1 ? "clause-complex" : "clause";
}

function constructionForStrategy(constructions, strategy) {
  return constructions.find(item => item.type === strategy)
    || (strategy === "participial-phrase"
      ? constructions.find(item => ["present-participle", "perfect-passive-participle", "future-participle", "participial-phrase"].includes(item.type))
      : null);
}
