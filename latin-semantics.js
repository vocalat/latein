/**
 * Sentence-level semantic scoring for the deterministic Latin -> German
 * pipeline.  This module contains no source-sentence translations.  It ranks
 * lexical meanings from grammatical roles, valency, semantic classes and
 * reusable collocation records.
 */

import { LATIN_COLLOCATIONS, SOURCE_WEIGHTS, VERB_CLASSES } from "./latin-language-data.js";

const LINGUISTIC_SOURCE_WEIGHT = 11;

/**
 * Rank every viable verbal meaning after parsing.  Dictionary provenance is a
 * strong prior, while a matched valency frame or collocation can reject a
 * semantically impossible book sense.
 */
export function rankVerbMeanings({
  lemma = "",
  lexicalCandidates = [],
  frame = null,
  context = {}
} = {}) {
  const collocations = LATIN_COLLOCATIONS
    .filter(record => record.head === lemma && ruleMatches(record, context));
  const frameRules = (frame?.senses || []).filter(rule => ruleMatches(rule, context));
  const semanticTargets = [
    ...collocations.map(record => ({ sense: record.german, kind: "collocation", id: record.id, weight: record.weight || 100 })),
    ...frameRules.map((rule, index) => ({ sense: rule.german, kind: "valency", id: rule.id || `${lemma}-frame-${index}`, weight: rule.weight || 72 }))
  ].filter(target => target.sense);

  const candidates = [
    ...lexicalCandidates,
    ...(frame?.defaultSense ? [{
      sense: frame.defaultSense,
      source: "linguistic",
      entry: null,
      origin: "valency-default"
    }] : []),
    ...semanticTargets.map(target => ({
      sense: target.sense,
      source: target.kind,
      entry: null,
      origin: target.kind,
      ruleId: target.id
    }))
  ].filter(candidate => candidate?.sense);

  const scored = candidates.map((candidate, candidateOrder) => scoreCandidate({
    ...candidate,
    candidateOrder
  }, {
    frame,
    context,
    semanticTargets,
    nonModalLatinPredicate: !VERB_CLASSES.modal.has(lemma)
  }));
  const distinct = bestCandidatePerSense(scored)
    .sort((left, right) => right.score - left.score
      || sourcePriority(right.source) - sourcePriority(left.source)
      || left.candidateOrder - right.candidateOrder);
  const rankedSelection = distinct[0] || null;
  const selectedLexical = rankedSelection
    ? scored
      .filter(candidate => candidate.entry && senseMatches(candidate.sense, rankedSelection.sense))
      .sort((left, right) => right.score - left.score
        || sourcePriority(right.source) - sourcePriority(left.source))[0]
    : null;
  const selected = rankedSelection
    ? {
      ...rankedSelection,
      entry: rankedSelection.entry || selectedLexical?.entry || null,
      lexicalSource: rankedSelection.entry
        ? rankedSelection.source
        : selectedLexical?.source || null
    }
    : null;
  const runnerUp = distinct[1] || null;
  const margin = selected ? selected.score - (runnerUp?.score ?? selected.score - 24) : 0;

  return {
    sense: selected?.sense || "",
    entry: selected?.entry || null,
    confidence: selected ? roundConfidence(1 / (1 + Math.exp(-margin / 18))) : 0,
    provenance: selected ? {
      semanticSource: selected.source,
      lexicalSource: selected.lexicalSource,
      ruleIds: selected.evidence
        .filter(item => /^(?:collocation|valency):/u.test(item))
        .map(item => item.split(":").slice(1).join(":"))
    } : null,
    collocation: collocations[0] || null,
    candidates: distinct.map(candidate => ({
      sense: candidate.sense,
      source: candidate.source,
      score: candidate.score,
      evidence: candidate.evidence,
      entry: candidate.entry || null
    }))
  };
}

/**
 * Build an explicit semantic representation from the selected word meanings.
 * German planning consumes these frames instead of consulting Latin order.
 */
export function buildSemanticFrames(interpretation = {}, words = []) {
  const constructions = interpretation.constructions || [];
  return (interpretation.clauses || []).map(clause => {
    const predicate = clause.headIndex == null ? null : words[clause.headIndex];
    const constructionRecords = constructions.filter(item =>
      item.clauseId === clause.id
      || [item.governingIndex, item.headIndex, item.participleIndex, item.infinitiveIndex]
        .some(index => index != null && clause.tokenIndexes.includes(index))
    );
    return {
      id: `semantic-${clause.id}`,
      clauseId: clause.id,
      clauseType: clause.type,
      predicate: predicate ? semanticWord(predicate) : null,
      arguments: {
        subject: semanticRole(clause.roles?.subject, words),
        directObject: semanticRole(clause.roles?.directObject, words),
        indirectObject: semanticRole(clause.roles?.indirectObject, words),
        genitive: semanticRole(clause.roles?.genitive, words),
        ablative: semanticRole(clause.roles?.ablative, words),
        adverbial: semanticRole(clause.roles?.adverbial, words),
        prepositional: (clause.roles?.prepositional || []).map(item => ({
          ...item,
          object: semanticWord(words[item.objectIndex])
        }))
      },
      constructions: constructionRecords.map(item => ({
        type: item.type,
        id: item.id || null,
        governingIndex: item.governingIndex ?? item.headIndex ?? null
      })),
      collocation: predicate?.semanticSelection?.collocation || null
    };
  });
}

function scoreCandidate(candidate, { frame, context, semanticTargets, nonModalLatinPredicate }) {
  let score = sourcePriority(candidate.source) * 5;
  const evidence = [`source:${candidate.source || "unknown"}`];
  const targetMatches = semanticTargets.filter(target => senseMatches(candidate.sense, target.sense));

  if (semanticTargets.length) {
    if (targetMatches.length) {
      const semanticScore = Math.max(...targetMatches.map(target => target.weight));
      score += semanticScore;
      evidence.push(...targetMatches.map(target => `${target.kind}:${target.id}`));
    } else {
      score -= 82;
      evidence.push("context-conflict");
    }
  }

  if (frame?.defaultSense && senseMatches(candidate.sense, frame.defaultSense)) {
    score += 16;
    evidence.push("valency-default");
  }

  const lexicalFrames = candidate.entry?.frames || [];
  if (lexicalFrames.length) {
    const matches = lexicalFrames.filter(rule => ruleMatches(rule, context));
    if (matches.length) {
      score += 44;
      evidence.push("dictionary-frame");
    } else {
      score -= 46;
      evidence.push("dictionary-frame-conflict");
    }
  }

  if (candidate.source === "book" && (!semanticTargets.length || targetMatches.length)) {
    score += 32;
    evidence.push("compatible-book-priority");
  }

  if (nonModalLatinPredicate && /^(?:dürfen|können|mögen|müssen|sollen|wollen)$/iu.test(candidate.sense)) {
    score -= 48;
    evidence.push("non-modal-latin-predicate");
  }

  return { ...candidate, score, evidence };
}

function ruleMatches(rule = {}, context = {}) {
  if (rule.withPreposition && !context.prepositions?.includes(rule.withPreposition)) return false;
  if (rule.withDirectObject && !context.objectLemmas?.length) return false;
  if (rule.withConstruction && !context.constructionTypes?.includes(rule.withConstruction)) return false;
  const objectLemmaMatch = rule.objectLemmas?.some(lemma => context.objectLemmas?.includes(lemma));
  const objectClassMatch = rule.objectSemanticClasses?.some(value => context.objectSemanticClasses?.includes(value));
  if (rule.objectLemmas && rule.objectSemanticClasses && !objectLemmaMatch && !objectClassMatch) return false;
  if (rule.objectLemmas && !rule.objectSemanticClasses && !objectLemmaMatch) return false;
  if (rule.subjectLemmas && !rule.subjectLemmas.some(lemma => context.subjectLemmas?.includes(lemma))) return false;
  if (rule.indirectObjectLemmas && !rule.indirectObjectLemmas.some(lemma => context.indirectObjectLemmas?.includes(lemma))) return false;
  if (rule.objectSemanticClasses && !rule.objectLemmas && !objectClassMatch) return false;
  if (rule.subjectSemanticClasses && !rule.subjectSemanticClasses.some(value => context.subjectSemanticClasses?.includes(value))) return false;
  if (rule.objectCase && !context.objectCases?.includes(rule.objectCase)) return false;
  if (rule.objectSemanticClass && !context.objectSemanticClasses?.includes(rule.objectSemanticClass)) return false;
  if (rule.subjectSemanticClass && !context.subjectSemanticClasses?.includes(rule.subjectSemanticClass)) return false;
  if (rule.voice && context.voice !== rule.voice) return false;
  if (rule.mood && context.mood !== rule.mood) return false;
  if (rule.tense && context.tense !== rule.tense) return false;
  return true;
}

function bestCandidatePerSense(candidates) {
  const bySense = new Map();
  for (const candidate of candidates) {
    const key = normalizeGerman(candidate.sense);
    const current = bySense.get(key);
    if (!current || candidate.score > current.score
      || candidate.score === current.score && sourcePriority(candidate.source) > sourcePriority(current.source)) {
      bySense.set(key, candidate);
    }
  }
  return [...bySense.values()];
}

function sourcePriority(source) {
  return SOURCE_WEIGHTS[source] ?? LINGUISTIC_SOURCE_WEIGHT;
}

function senseMatches(left, right) {
  const normalizedLeft = normalizeGerman(left);
  const normalizedRight = normalizeGerman(right);
  return normalizedLeft === normalizedRight;
}

function normalizeGerman(value) {
  return String(value || "")
    .toLocaleLowerCase("de")
    .replace(/^(?:etwas|jemanden|jemandem)\s+/u, "")
    .replace(/[^a-zäöüß]/gu, "");
}

function semanticRole(indexes = [], words = []) {
  return indexes.map(index => semanticWord(words[index])).filter(Boolean);
}

function semanticWord(word) {
  if (!word) return null;
  return {
    index: word.index,
    lemma: word.lemma,
    sense: word.sense || "",
    part: word.morphology?.part || word.entry?.pos || "x",
    case: word.morphology?.case || null,
    number: word.morphology?.number || null,
    gender: word.morphology?.gender || null,
    semanticClass: word.entry?.semanticClass || null
  };
}

function roundConfidence(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
