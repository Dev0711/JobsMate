/* Edit YOUR Word resume in place: find the skill lines and append new skills with the same formatting.
   Only word/document.xml is touched, and only by appending runs to existing skill paragraphs. */
import { JSZip } from "./vendor/docx-tools.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const SECTION_HEAD = /^(technical\s+)?skills?(\s*(&|and|\/)\s*(tools|technologies|expertise))?$|^(tech(nical)?\s+stack|technologies|core\s+competencies|key\s+skills|tools\s*(&|and)\s*technologies|skill\s*set|expertise)$/i;
const OTHER_HEAD = /^(work\s+)?experience|^employment|^professional experience|^projects?|^education|^certifications?|^achievements?|^awards|^summary|^profile|^objective|^publications|^languages known|^interests|^hobbies|^contact|^personal|^declaration|^references/i;

export async function loadDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("That doesn't look like a Word (.docx) file.");
  const xml = await file.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Couldn't read this Word file.");
  return { zip, doc };
}

const paras = (doc) => [...doc.getElementsByTagNameNS(W, "p")];
export function paraText(p) {
  let t = "";
  for (const n of p.getElementsByTagNameNS(W, "*")) {
    if (n.localName === "t") t += n.textContent;
    else if (n.localName === "tab") t += "\t";
    else if (n.localName === "br") t += "\n";
  }
  return t;
}
/** plain text of the whole document, one paragraph per line */
export const docxText = (doc) => paras(doc).map(paraText).join("\n");

const isHeading = (p, text) => {
  const t = text.trim();
  if (!t || t.length > 45 || /[,;]/.test(t)) return false;
  const style = p.getElementsByTagNameNS(W, "pStyle")[0];
  const styled = style && /heading|title/i.test(style.getAttributeNS(W, "val") || style.getAttribute("w:val") || "");
  return styled || SECTION_HEAD.test(t.replace(/[:\s]+$/, "")) || OTHER_HEAD.test(t) || (t === t.toUpperCase() && /[A-Z]{3}/.test(t));
};
const splitItems = (s) => {
  const sep = / \| /.test(s) ? " | " : /•/.test(s) ? " • " : /;/.test(s) && !/,/.test(s) ? "; " : ", ";
  const items = s.split(/\s*[|•;,]\s*/).map((x) => x.replace(/\.$/, "").trim()).filter(Boolean);
  return { items, sep };
};
const LABEL_LINE = /^\s*([A-Za-z][A-Za-z0-9 &/+().'-]{1,40}?)\s*[:–—]\s*(.+)$/;

/** Find the skill lines: [{label, items, sep, para}] where new skills get appended to `para`. */
export function findSkillLines(doc) {
  const ps = paras(doc);
  let start = ps.findIndex((p) => { const t = paraText(p).trim().replace(/[:\s]+$/, ""); return t.length <= 45 && SECTION_HEAD.test(t); });
  if (start < 0) return [];
  let end = ps.length;
  for (let i = start + 1; i < ps.length; i++) {
    const t = paraText(ps[i]);
    if (isHeading(ps[i], t) && !LABEL_LINE.test(t) && !SECTION_HEAD.test(t.trim())) { end = i; break; }
  }
  const lines = [];
  const used = new Set();
  for (let i = start + 1; i < end; i++) {
    const p = ps[i];
    if (used.has(p)) continue;
    const text = paraText(p).replace(/\s+/g, " ").trim();
    if (!text) continue;
    // (b) table row: label cell + items cell
    const tc = p.parentNode && p.parentNode.localName === "tc" ? p.parentNode : null;
    if (tc) {
      const next = tc.nextElementSibling;
      if (next && next.localName === "tc" && text.length <= 40 && !/,/.test(text)) {
        const ips = [...next.getElementsByTagNameNS(W, "p")];
        const itext = ips.map(paraText).join(", ").trim();
        if (itext) {
          ips.forEach((x) => used.add(x));
          const { items, sep } = splitItems(itext);
          lines.push({ label: text.replace(/[:\s]+$/, ""), items, sep, para: ips[ips.length - 1] });
          continue;
        }
      }
    }
    // (a) "Frontend: React, TypeScript"
    const m = text.match(LABEL_LINE);
    if (m && /[,|•;]/.test(m[2]) || (m && m[2].split(" ").length <= 4)) {
      const { items, sep } = splitItems(m[2]);
      lines.push({ label: m[1].trim(), items, sep, para: p });
      continue;
    }
    // (c) label paragraph, list on the next paragraph
    const nextP = ps[i + 1];
    if (text.length <= 40 && !/[,|•]/.test(text) && nextP && i + 1 < end) {
      const nt = paraText(nextP).replace(/\s+/g, " ").trim();
      if (/[,|•;]/.test(nt) && !LABEL_LINE.test(nt)) {
        used.add(nextP);
        const { items, sep } = splitItems(nt);
        lines.push({ label: text.replace(/[:\s]+$/, ""), items, sep, para: nextP });
        continue;
      }
    }
    // (d) a plain comma list with no label
    if ((text.match(/,/g) || []).length >= 2) {
      const { items, sep } = splitItems(text);
      lines.push({ label: "Skills", items, sep, para: p });
    }
  }
  return lines;
}

/** Append text to the end of a paragraph, copying the formatting of its last text run. */
function appendToParagraph(doc, p, text) {
  const runs = [...p.getElementsByTagNameNS(W, "r")].filter((r) => r.getElementsByTagNameNS(W, "t").length);
  const last = runs[runs.length - 1];
  const run = doc.createElementNS(W, "w:r");
  if (last) {
    const rPr = [...last.childNodes].find((n) => n.localName === "rPr");
    if (rPr) run.appendChild(rPr.cloneNode(true));
  }
  const t = doc.createElementNS(W, "w:t");
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
  t.textContent = text;
  run.appendChild(t);
  if (!last) { p.appendChild(run); return; }
  // insert right after the last run, at paragraph level (step out of hyperlinks / smart tags)
  let anchor = last;
  while (anchor.parentNode && anchor.parentNode !== p) anchor = anchor.parentNode;
  p.insertBefore(run, anchor.nextSibling);
}

/** additions: [{skill, lineIndex}] → { buffer (Uint8Array .docx), changes: [{skill, label}] } */
export async function addSkills(buffer, additions) {
  const { zip, doc } = await loadDocx(buffer);
  const lines = findSkillLines(doc);
  const all = docxText(doc).toLowerCase();
  const byLine = new Map();
  const changes = [];
  for (const a of additions) {
    const ln = lines[a.lineIndex];
    if (!ln) continue;
    if (new RegExp("(^|[^a-z0-9])" + a.skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(all)) continue; // already on the resume
    if (!byLine.has(a.lineIndex)) byLine.set(a.lineIndex, []);
    byLine.get(a.lineIndex).push(a.skill);
    changes.push({ skill: a.skill, label: ln.label });
  }
  for (const [i, skills] of byLine) {
    const ln = lines[i];
    const ends = paraText(ln.para).trimEnd();
    const lead = /[,|•;]$/.test(ends) ? " " : ln.sep;
    appendToParagraph(doc, ln.para, lead + skills.join(ln.sep));
  }
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { buffer: out, changes };
}

/** convenience for the side panel: lines + text from a stored .docx */
export async function inspectDocx(buffer) {
  const { doc } = await loadDocx(buffer);
  const lines = findSkillLines(doc).map(({ label, items, sep }) => ({ label, items, sep }));
  return { lines, text: docxText(doc) };
}
