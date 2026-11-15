/* Resume PDF text extraction (pdf.js) + offline heuristic parsing. */
import * as pdfjs from "./vendor/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/vendor/pdf.worker.min.mjs");

export async function pdfText(arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, items]) => out.push(items.sort((a, b) => a.x - b.x).map((t) => t.s).join(" ").replace(/\s+/g, " ").trim()));
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const SECTION = /^(professional\s+summary|summary|profile|objective|about me|(work|professional)\s+experience|experience|employment( history)?|projects?|personal projects|education|academics|skills|technical skills|key skills|certifications?|achievements|awards)\s*:?$/i;
const DATE_RANGE = /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}|\d{1,2}\/\d{4}|\b(19|20)\d{2}\b)\s*(-|–|—|to)\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}|\d{1,2}\/\d{4}|\b(19|20)\d{2}\b|present|current|now|till date)/i;
const BULLET = /^[•●▪◦\-*–·]\s*/;

export function heuristicParse(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const p = { experience: [], projects: [], education: [] };
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) p.email = email[0];
  const phone = text.match(/(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/) || text.match(/\+?\d[\d\s-]{8,14}\d/);
  if (phone) p.phone = phone[0].replace(/[\s-]/g, "");
  const li = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w\-%]+/i);
  if (li) p.linkedin = (li[1] ? "" : "https://") + li[0];
  const gh = text.match(/(https?:\/\/)?(www\.)?github\.com\/[\w-]+/i);
  if (gh) p.github = (gh[1] ? "" : "https://") + gh[0];
  const urls = (text.match(/https?:\/\/[^\s)]+/g) || []).filter((u) => !/linkedin|github/i.test(u));
  if (urls[0]) p.portfolio = urls[0];
  const nameLine = lines.slice(0, 6).find((l) => /^[A-Za-z][A-Za-z.' ]{2,40}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 4 && !/resume|curriculum|vitae/i.test(l));
  if (nameLine) {
    const parts = nameLine.split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    p.firstName = parts[0];
    p.lastName = parts.slice(1).join(" ");
  }
  const skills = AM.findSkills(text.replace(/https?:\/\/\S+|\S+@\S+/g, " "));
  if (skills.length) p.skills = skills.join(", ");
  const exp = text.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)\s*(?:of)?\s*(?:experience|exp)/i);
  if (exp) p.totalExperience = exp[1];

  // split into sections
  const sections = {};
  let cur = "header";
  for (const l of lines) {
    if (SECTION.test(l) && l.length < 40) { cur = l.toLowerCase(); continue; }
    (sections[cur] = sections[cur] || []).push(l);
  }
  const sec = (re) => Object.entries(sections).filter(([k]) => re.test(k)).flatMap(([, v]) => v);
  const summary = sec(/summary|profile|objective|about/).join(" ").trim();
  if (summary) p.summary = summary.slice(0, 700);

  // experience entries: a line with a date range starts an entry
  const expLines = sec(/experience|employment/);
  let entry = null;
  expLines.forEach((l, i) => {
    if (!l) return;
    const dm = l.match(DATE_RANGE);
    if (dm) {
      const head = l.replace(DATE_RANGE, "").replace(/[|,–-]\s*$/, "").trim();
      const prev = expLines[i - 1] && !BULLET.test(expLines[i - 1]) && !(entry && entry.bullets.length === 0 && entry._head === expLines[i - 1]) ? expLines[i - 1] : "";
      const [a, b] = (head || prev).split(/\s*[,|]\s*|\s+(?:at|@|–|-)\s+/);
      entry = { company: (b || prev || "").trim(), title: (a || "").trim(), start: dm[1], end: dm[5], bullets: [], _head: l };
      if (entry.company === entry.title) entry.company = prev && prev !== head ? prev : "";
      p.experience.push(entry);
    } else if (entry && (BULLET.test(l) || l.length > 50)) {
      if (BULLET.test(l) || !entry.bullets.length) entry.bullets.push(l.replace(BULLET, ""));
      else entry.bullets[entry.bullets.length - 1] += " " + l;
    }
  });
  p.experience.forEach((e) => delete e._head);
  if (p.experience[0]) {
    if (!p.currentCompany) p.currentCompany = p.experience[0].company;
    if (!p.currentTitle) p.currentTitle = p.experience[0].title;
  }

  // projects: non-bullet short line = project name
  let proj = null;
  for (const l of sec(/project/)) {
    if (!l) continue;
    if (!BULLET.test(l) && l.length < 90) { proj = { name: l.replace(/\|.*$/, "").trim(), link: (l.match(/https?:\/\/\S+/) || [""])[0], bullets: [] }; p.projects.push(proj); }
    else if (proj) proj.bullets.push(l.replace(BULLET, ""));
  }

  const edu = sec(/education|academic/).join("\n");
  const DEG = /\b(B\.?\s?Tech|B\.?E\.?|M\.?\s?Tech|MCA|BCA|B\.?Sc|M\.?Sc|MBA|B\.?Com|Bachelor|Master|Ph\.?D)\b/i;
  const eduLine = (edu || text).split("\n").find((l) => DEG.test(l) || /University|Institute|College|IIT|NIT|IIIT|BITS/i.test(l)) || "";
  const parts = eduLine.replace(DATE_RANGE, "").split(/\s*[,|]\s*|\s+-\s+/).map((x) => x.replace(/\(\s*\d{4}\s*\)/, "").trim()).filter(Boolean);
  const deg = parts.find((x) => DEG.test(x));
  if (deg) p.degree = deg.slice(0, 90);
  const col = parts.find((x) => /University|Institute|College|IIT|NIT|IIIT|BITS|School/i.test(x) && x !== deg);
  if (col) p.college = col.slice(0, 100);
  const yr = (edu.match(/\b(19|20)\d{2}\b(?![\s\S]*\b(19|20)\d{2}\b)/) || [])[0];
  if (yr) p.gradYear = yr;
  const cg = edu.match(/(cgpa|gpa)[:\s]*([\d.]+)/i) || edu.match(/([\d.]{2,5})\s*%/) || eduLine.match(/,\s*(\d{1,2}\.\d{1,2})\s*$/);
  if (cg) p.cgpa = cg[2] || (/%/.test(cg[0]) ? cg[1] + "%" : cg[1]);
  if (p.degree || p.college) p.education.push({ degree: p.degree || "", school: p.college || "", year: p.gradYear || "", score: p.cgpa || "" });
  return p;
}
