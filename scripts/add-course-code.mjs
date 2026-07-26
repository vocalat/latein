#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCourseAccessCode } from "../course-access.js";

const ACCESS_DIGEST_NAMESPACE = "VocaLat/course-access/access-digest/v1";
const SESSION_PROOF_NAMESPACE = "VocaLat/course-access/session-proof/v1";
const SESSION_VERIFIER_NAMESPACE = "VocaLat/course-access/session-verifier/v1";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(repoRoot, "..");
const publicPath = join(repoRoot, "data", "course-access.json");
const privatePath = join(homedir(), "Library", "Application Support", "VocaLat", "private", "access-codes.csv");

try {
  const options = parseArguments(process.argv.slice(2));
  const normalizedCode = normalizeCourseAccessCode(options.code);
  if (!normalizedCode) throw new Error("Der Freischaltcode hat kein gültiges Format.");

  assertPrivatePath();
  const manifest = JSON.parse(readFileSync(publicPath, "utf8"));
  const rows = readPrivateRows();
  const id = options.id || nextRecordId(manifest.records);
  if (!/^course-\d{4}$/.test(id)) throw new Error("Die ID muss dem Format course-0001 entsprechen.");
  if (manifest.records.some(record => record.id === id) || rows.some(row => row[0] === id)) {
    throw new Error("Diese Code-ID ist bereits vergeben.");
  }

  const record = createRecord(normalizedCode, id, manifest.revision);
  if (manifest.records.some(existing => existing.accessDigest === record.accessDigest)) {
    process.stdout.write("Freischaltcode ist bereits aktiv.\n");
    process.exit(0);
  }

  const nextManifest = { ...manifest, records: [...manifest.records, record] };
  const nextRows = [...rows, [id, options.code, "true", String(manifest.revision)]];
  writeOutputs(nextManifest, nextRows);
  process.stdout.write(`Freischaltcode ${id} wurde hinzugefügt.\n`);
} catch (error) {
  process.stderr.write(`Freischaltcode konnte nicht hinzugefügt werden: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = { code: "", id: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!["--code", "--id"].includes(argument)) throw new Error(`Unbekannte Option: ${argument}`);
    const value = args[index + 1];
    if (!value) throw new Error(`${argument} benötigt einen Wert.`);
    index += 1;
    if (argument === "--code") result.code = value;
    if (argument === "--id") result.id = value;
  }
  if (!result.code) throw new Error("--code ist erforderlich.");
  return result;
}

function assertPrivatePath() {
  const candidate = canonicalPotentialPath(privatePath);
  if (inside(candidate, repoRoot) || inside(candidate, workspaceRoot)) {
    throw new Error("Die private Code-Liste muss außerhalb des Repositories und Arbeitsordners liegen.");
  }
}

function readPrivateRows() {
  if (!existsSync(privatePath)) throw new Error("Die private Code-Liste wurde nicht gefunden.");
  const rows = readFileSync(privatePath, "utf8").trim().split(/\r?\n/).map(parseCsvLine);
  if (rows[0]?.join(",") !== "id,code,active,revision") throw new Error("Die private Code-Liste hat ein unerwartetes Format.");
  return rows;
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

function nextRecordId(records) {
  const highest = records.reduce((maximum, record) => {
    const match = /^course-(\d{4})$/.exec(record.id || "");
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  if (highest >= 9999) throw new Error("Es ist keine freie Code-ID mehr verfügbar.");
  return `course-${String(highest + 1).padStart(4, "0")}`;
}

function createRecord(normalizedCode, id, revision) {
  const proof = sha256(Buffer.from(`${SESSION_PROOF_NAMESPACE}\0${normalizedCode}`, "utf8"));
  return {
    id,
    accessDigest: sha256(Buffer.from(`${ACCESS_DIGEST_NAMESPACE}\0${normalizedCode}`, "utf8")).toString("hex"),
    sessionVerifier: sha256(Buffer.concat([Buffer.from(`${SESSION_VERIFIER_NAMESPACE}\0`, "utf8"), proof])).toString("hex"),
    active: true,
    revision
  };
}

function writeOutputs(manifest, rows) {
  const privateDirectory = dirname(privatePath);
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  chmodSync(privateDirectory, 0o700);

  const privateTemporary = `${privatePath}.tmp-${process.pid}`;
  const publicTemporary = `${publicPath}.tmp-${process.pid}`;
  try {
    const csv = `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
    writeFileSync(privateTemporary, csv, { encoding: "utf8", flag: "wx", mode: 0o600 });
    writeFileSync(publicTemporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    chmodSync(privateTemporary, 0o600);
    renameSync(privateTemporary, privatePath);
    renameSync(publicTemporary, publicPath);
    chmodSync(privatePath, 0o600);
    if ((statSync(privatePath).mode & 0o777) !== 0o600) throw new Error("Private Dateirechte konnten nicht gesetzt werden.");
  } finally {
    rmSync(privateTemporary, { force: true });
    rmSync(publicTemporary, { force: true });
  }
}

function canonicalPotentialPath(candidate) {
  const absolute = resolve(candidate);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  return resolve(canonicalAncestor, relative(ancestor, absolute));
}

function inside(candidate, parent) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function csvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}
