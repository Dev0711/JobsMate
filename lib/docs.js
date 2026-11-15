/* ATS-safe single-column resume + cover letter as PDF (jsPDF) and DOCX (docx). */
import { jsPDF, Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "./vendor/bundle.js";

/** data: {name, contact, summary, skills[], experience[{company,title,start,end,bullets[]}], projects[{name,link,bullets[]}], education[{degree,school,year,score}]} */
export function resumeData(profile, overrides = {}) {
  const contact = [profile.phone, profile.email, profile.city, profile.linkedin, profile.github, profile.portfolio].filter(Boolean).join("  |  ");
  return {
    name: AM.profileValue(profile, "fullName"),
    title: profile.currentTitle,
    contact,
    summary: overrides.summary ?? profile.summary,
    skills: overrides.skills ?? AM.splitList(profile.skills),
    experience: (profile.experience || []).map((e, i) => ({ ...e, bullets: (overrides.experience && overrides.experience[i]) || e.bullets || [] })),
    projects: (profile.projects || []).map((e, i) => ({ ...e, bullets: (overrides.projects && overrides.projects[i]) || e.bullets || [] })),
    education: profile.education && profile.education.length ? profile.education : profile.degree ? [{ degree: profile.degree, school: profile.college, year: profile.gradYear, score: profile.cgpa }] : [],
  };
}

export function resumePdf(d) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 46, W = doc.internal.pageSize.getWidth() - M * 2, H = doc.internal.pageSize.getHeight();
  let y = M;
  const need = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const write = (text, { size = 10, bold = false, indent = 0, gap = 3, color = 20 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(String(text || ""), W - indent);
    for (const ln of lines) { need(size * 1.25); doc.text(ln, M + indent, y + size); y += size * 1.25; }
    y += gap;
  };
  const heading = (t) => {
    need(26); y += 6;
    write(t.toUpperCase(), { size: 10.5, bold: true, gap: 1, color: 30 });
    doc.setDrawColor(160); doc.setLineWidth(0.6); doc.line(M, y, M + W, y); y += 5;
  };
  write(d.name, { size: 20, bold: true, gap: 2 });
  if (d.title) write(d.title, { size: 11, gap: 2, color: 70 });
  write(d.contact, { size: 9, gap: 6, color: 70 });
  if (d.summary) { heading("Summary"); write(d.summary); }
  if (d.skills && d.skills.length) { heading("Skills"); write(d.skills.join(", ")); }
  if (d.experience.length) {
    heading("Experience");
    for (const e of d.experience) {
      need(30);
      write(`${e.title || ""}${e.company ? ", " + e.company : ""}`, { bold: true, size: 10.5, gap: 0 });
      if (e.start || e.end) write(`${e.start || ""} – ${e.end || ""}`, { size: 9, color: 90, gap: 2 });
      for (const b of e.bullets || []) write("•  " + b, { indent: 8, gap: 1 });
      y += 4;
    }
  }
  if (d.projects.length) {
    heading("Projects");
    for (const p of d.projects) {
      write(`${p.name}${p.link ? "  (" + p.link + ")" : ""}`, { bold: true, gap: 1 });
      for (const b of p.bullets || []) write("•  " + b, { indent: 8, gap: 1 });
      y += 4;
    }
  }
  if (d.education.length) {
    heading("Education");
    for (const e of d.education) write(`${e.degree || ""}${e.school ? ", " + e.school : ""}${e.year ? " (" + e.year + ")" : ""}${e.score ? ", " + e.score : ""}`);
  }
  return doc;
}

export async function resumeDocx(d) {
  const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text: String(text || ""), bold: opts.bold, size: opts.size, color: opts.color })], spacing: { after: opts.after ?? 60 }, bullet: opts.bullet ? { level: 0 } : undefined, alignment: opts.align });
  const H = (t) => new Paragraph({ text: t.toUpperCase(), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } });
  const children = [P(d.name, { bold: true, size: 36, after: 40 })];
  if (d.title) children.push(P(d.title, { size: 22, color: "555555", after: 20 }));
  children.push(P(d.contact, { size: 18, color: "555555", after: 120 }));
  if (d.summary) children.push(H("Summary"), P(d.summary));
  if (d.skills.length) children.push(H("Skills"), P(d.skills.join(", ")));
  if (d.experience.length) {
    children.push(H("Experience"));
    for (const e of d.experience) {
      children.push(P(`${e.title || ""}${e.company ? ", " + e.company : ""}`, { bold: true, after: 0 }));
      if (e.start || e.end) children.push(P(`${e.start || ""} – ${e.end || ""}`, { size: 18, color: "666666", after: 40 }));
      for (const b of e.bullets || []) children.push(P(b, { bullet: true, after: 20 }));
    }
  }
  if (d.projects.length) {
    children.push(H("Projects"));
    for (const p of d.projects) {
      children.push(P(`${p.name}${p.link ? " (" + p.link + ")" : ""}`, { bold: true, after: 20 }));
      for (const b of p.bullets || []) children.push(P(b, { bullet: true, after: 20 }));
    }
  }
  if (d.education.length) {
    children.push(H("Education"));
    for (const e of d.education) children.push(P(`${e.degree || ""}${e.school ? ", " + e.school : ""}${e.year ? " (" + e.year + ")" : ""}${e.score ? ", " + e.score : ""}`));
  }
  const doc = new Document({ styles: { default: { document: { run: { font: "Calibri", size: 21 } } } }, sections: [{ properties: { page: { margin: { top: 700, bottom: 700, left: 800, right: 800 } } }, children }] });
  return Packer.toBlob(doc);
}

export function letterPdf(text, profile) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 56, W = doc.internal.pageSize.getWidth() - M * 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(AM.profileValue(profile, "fullName") || "", M, M);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
  doc.text([profile.email, profile.phone, profile.city].filter(Boolean).join("  |  "), M, M + 16);
  doc.setTextColor(20); doc.setFontSize(11);
  let y = M + 50;
  for (const para of String(text).split(/\n/)) {
    const lines = doc.splitTextToSize(para || " ", W);
    for (const ln of lines) { if (y > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M; } doc.text(ln, M, y); y += 15; }
  }
  return doc;
}

export const pdfBase64 = (doc) => doc.output("datauristring").split(",")[1];
export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
