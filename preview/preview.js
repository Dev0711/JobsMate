/* Builds the final PDF from your edited Word resume and shows THAT PDF.
   Word → (docx-preview render) → Chrome's own print-to-PDF engine → real, text-based PDF → Chrome PDF viewer. */
import { renderAsync } from "../lib/vendor/docx-tools.js";

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let job = null, pdfBytes = null, pdfUrl = null;

function status(html, err = false) {
  $("#status").hidden = false;
  $("#status").innerHTML = `<div class="msg${err ? " err" : ""}">${html}</div>`;
}
const b64ToBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
function download(bytes, type, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Page size and margins come from the Word file, so the PDF paginates like your document. */
function pageCss() {
  const sec = document.querySelector("#render section.docx");
  if (!sec) return;
  const cs = sec.style;
  const w = cs.width || "21cm", h = cs.minHeight || cs.height || "29.7cm";
  const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((x) => x || "0.75in").join(" ");
  $("#pageStyle").textContent = `@page { size: ${w} ${h}; margin: ${pad}; }`;
}

/** Chrome's real print-to-PDF via the DevTools protocol (needs the optional "debugger" permission, asked once). */
async function chromePdf() {
  const tab = await chrome.tabs.getCurrent();
  const target = { tabId: tab.id };
  await chrome.debugger.attach(target, "1.3");
  try {
    const res = await chrome.debugger.sendCommand(target, "Page.printToPDF", { printBackground: true, preferCSSPageSize: true, generateDocumentOutline: false });
    return b64ToBytes(res.data);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function build() {
  if (!(await chrome.permissions.contains({ permissions: ["debugger"] }))) {
    status(`<b>One-time permission needed.</b><br>To turn your Word resume into a PDF exactly as Chrome prints it, ApplyMate needs Chrome's “debugger” access for this page.
      While it runs (about a second) Chrome shows a “started debugging this browser” bar; that's this conversion.<br><br>
      <button class="pri" id="grant">Allow and create PDF</button> <button id="printInstead">Use Chrome's print dialog instead</button>`);
    $("#grant").onclick = async () => {
      const ok = await chrome.permissions.request({ permissions: ["debugger"] }).catch(() => false);
      ok ? make() : printFallback("Permission wasn't granted.");
    };
    $("#printInstead").onclick = () => printFallback();
    return;
  }
  make();
}

async function make() {
  status("Creating your PDF…");
  try {
    pdfBytes = await chromePdf();
    showPdf();
  } catch (e) {
    printFallback("Automatic PDF creation didn't work here (" + (e.message || e) + ").");
  }
}

function showPdf() {
  pdfUrl && URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
  $("#status").hidden = true;
  $("#pdfView").hidden = false;
  $("#pdfView").src = pdfUrl + "#view=FitH";
  $("#useBtn").disabled = false;
  $("#dlPdf").disabled = false;
}

function printFallback(why = "") {
  $("#render").classList.add("showing");
  status(`${why ? why + "<br>" : ""}Use Chrome's print dialog: it shows the PDF preview. Choose <b>Save as PDF</b> → Save, then upload that PDF in ApplyMate → Profile.<br><br><button class="pri" id="doPrint">Open print / Save as PDF</button>`);
  $("#doPrint").onclick = () => window.print();
}

async function init() {
  job = (await chrome.storage.session.get("resumePreview")).resumePreview;
  if (!job) return status("Nothing to preview. Start from ApplyMate → Profile → Update my resume.", true);
  const rec = await AM.get("file:" + job.docxFileId);
  if (!rec) return status("The edited Word file wasn't found. Try Preview again from the side panel.", true);
  $("#fileName").textContent = job.baseName + " (updated)";
  $("#changes").innerHTML = job.changes.length
    ? job.changes.map((c) => `<span class="chip">+ ${AM.esc(c.skill)} → ${AM.esc(c.label)}</span>`).join("")
    : `<span class="muted">No new skills (they're already on your resume)</span>`;
  const docx = b64ToBytes(rec.data);
  await renderAsync(docx.buffer, $("#render"), null, { className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: true, renderFooters: true, experimental: true });
  pageCss();
  await document.fonts.ready;
  await sleep(150);
  window.__AM_previewReady = true;
  build();
}

$("#dlDocx").onclick = async () => {
  const rec = await AM.get("file:" + job.docxFileId);
  download(b64ToBytes(rec.data), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${job.baseName} (updated).docx`);
};
$("#dlPdf").onclick = () => download(pdfBytes, "application/pdf", `${job.baseName} (updated).pdf`);
$("#closeBtn").onclick = async () => { await chrome.storage.session.remove("resumePreview"); window.close(); };
$("#useBtn").onclick = async () => {
  // save the PDF as your resume + keep the edited Word file as the new source for future edits
  const files = await AM.get("files", []);
  const pdfId = AM.uid(), docxId = AM.uid();
  const docxRec = await AM.get("file:" + job.docxFileId);
  await AM.set("file:" + pdfId, { name: `${job.baseName} (updated).pdf`, type: "application/pdf", data: bytesToB64(pdfBytes) });
  await AM.set("file:" + docxId, { ...docxRec, name: `${job.baseName} (updated).docx` });
  files.unshift({ id: pdfId, name: `${job.baseName} (updated).pdf`, kind: "resume", createdAt: new Date().toISOString(), size: pdfBytes.length },
                { id: docxId, name: `${job.baseName} (updated).docx`, kind: "resume-docx", createdAt: new Date().toISOString() });
  await AM.set("files", files);
  const profile = await AM.getProfile();
  profile.defaultResumeId = pdfId;
  profile.sourceDocxId = docxId;
  if (job.text) profile.resumeText = job.text;
  await AM.set("profile", profile);
  const added = new Set(job.changes.map((c) => c.skill.toLowerCase()));
  await AM.set("resumeQueue", (await AM.get("resumeQueue", [])).filter((q) => !added.has(q.skill.toLowerCase())));
  await chrome.storage.session.remove("resumePreview");
  $("#useBtn").disabled = true;
  $("#useBtn").textContent = "Saved ✓ This PDF is now attached to applications";
};

init().catch((e) => status("Couldn't open the resume: " + AM.esc(e.message || e), true));
