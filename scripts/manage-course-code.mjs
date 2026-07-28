#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCourseAccessCode } from "../course-access.js";

const ACCESS_DIGEST_NAMESPACE = "VocaLat/course-access/access-digest/v1";
const SESSION_PROOF_NAMESPACE = "VocaLat/course-access/session-proof/v1";
const SESSION_VERIFIER_NAMESPACE = "VocaLat/course-access/session-verifier/v1";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArguments(process.argv.slice(2));
  const plaintext = process.env.VOCALAT_ACCESS_CODE || "";
  const normalized = normalizeCourseAccessCode(plaintext);
  if (!normalized) throw new Error("Der Freischaltcode ist leer oder enthält nicht unterstützte Steuerzeichen.");

  const manifest = readManifest(options.manifest);
  const digest = sha256Hex(`${ACCESS_DIGEST_NAMESPACE}\0${normalized}`);
  const matchingIndex = manifest.records.findIndex(record => record.accessDigest === digest);
  const nextRevision = manifest.revision + 1;
  let records = [...manifest.records];
  let changed = false;

  if (options.action === "activate") {
    if (matchingIndex >= 0) {
      const current = records[matchingIndex];
      if (!current.active) {
        records[matchingIndex] = { ...current, active: true, revision: current.revision + 1 };
        changed = true;
      }
    } else {
      records.push(createRecord(normalized, nextRecordId(records), nextRevision));
      changed = true;
    }
  } else {
    if (matchingIndex < 0) throw new Error("Zu diesem Code wurde kein Eintrag gefunden.");
    const current = records[matchingIndex];
    if (current.active) {
      records[matchingIndex] = { ...current, active: false, revision: current.revision + 1 };
      changed = true;
    }
  }

  if (changed) {
    writeManifest(options.manifest, {
      ...manifest,
      revision: nextRevision,
      records
    });
  }
  process.stdout.write(changed
    ? `Freischaltcode wurde ${options.action === "activate" ? "aktiviert" : "gesperrt"}.\n`
    : `Freischaltcode war bereits ${options.action === "activate" ? "aktiv" : "gesperrt"}.\n`);
} catch (error) {
  process.stderr.write(`Freischaltcode konnte nicht verwaltet werden: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = {
    action: process.env.VOCALAT_ACCESS_ACTION || "activate",
    manifest: join(repoRoot, "data", "course-access.json")
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!["--action", "--manifest"].includes(argument)) throw new Error(`Unbekannte Option: ${argument}`);
    const value = args[index + 1];
    if (!value) throw new Error(`${argument} benötigt einen Wert.`);
    index += 1;
    if (argument === "--action") result.action = value;
    else result.manifest = resolve(value);
  }
  if (!["activate", "revoke"].includes(result.action)) {
    throw new Error("Die Aktion muss activate oder revoke sein.");
  }
  return result;
}

function readManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.active !== true ||
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 1 ||
    !Array.isArray(manifest.records)
  ) throw new Error("Die öffentliche Code-Datei hat ein ungültiges Format.");
  return manifest;
}

function createRecord(normalized, id, revision) {
  const proof = sha256Buffer(`${SESSION_PROOF_NAMESPACE}\0${normalized}`);
  return {
    id,
    accessDigest: sha256Hex(`${ACCESS_DIGEST_NAMESPACE}\0${normalized}`),
    sessionVerifier: createHash("sha256")
      .update(Buffer.concat([
        Buffer.from(`${SESSION_VERIFIER_NAMESPACE}\0`, "utf8"),
        proof
      ]))
      .digest("hex"),
    active: true,
    revision
  };
}

function nextRecordId(records) {
  const highest = records.reduce((maximum, record) => {
    const match = /^course-(\d{4})$/.exec(record.id || "");
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  if (highest >= 9999) throw new Error("Es ist keine freie Code-ID mehr verfügbar.");
  return `course-${String(highest + 1).padStart(4, "0")}`;
}

function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function sha256Buffer(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest();
}

function sha256Hex(value) {
  return sha256Buffer(value).toString("hex");
}
