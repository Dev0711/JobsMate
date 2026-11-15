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

/** Print each rendered Word page as one PDF page of the same size, without changing its layout. */
function pageCss() {
  const sec = document.querySelector("#render section.docx");
  if (!sec) return;
  const cs = sec.style;
  const w = cs.width || "21cm", h = cs.minHeight || cs.height || "29.7cm";
  $("#pageStyle").textContent = `@page { size: ${w} ${h}; margin: 0; }`;
}

/** Exact PDF: Microsoft Word itself converts the file, through the ApplyMate Word helper (native messaging). */
function wordPdf(docxB64) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative("com.applymate.word"); } catch (e) { return reject(new Error("helper-missing")); }
    const parts = [];
    let done = false;
    port.onMessage.addListener((m) => {
      if (!m.ok) { done = true; port.disconnect(); return reject(new Error(m.error || "Word couldn't convert the file")); }
      parts[m.index] = m.data;
      if (parts.filter((x) => x !== undefined).length === m.total) { done = true; port.disconnect(); resolve(b64ToBytes(parts.join(""))); }
    });
    port.onDisconnect.addListener(() => {
      if (done) return;
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      reject(new Error(/not found|forbidden|specified native messaging host/i.test(err || "") ? "helper-missing" : err || "The Word helper stopped unexpectedly"));
    });
    port.postMessage({ action: "docx2pdf", data: docxB64 });
  });
}

async function build() {
  status("Microsoft Word is creating your PDF… (about 5-10 seconds)");
  try {
    const rec = await AM.get("file:" + job.docxFileId);
    pdfBytes = await wordPdf(rec.data);
    showPdf("Made by Microsoft Word: exactly how Word prints your resume.");
  } catch (e) {
    if (e.message === "helper-missing") {
      status(`<b>For an exact PDF, set up the ApplyMate Word helper once.</b> It lets Microsoft Word on this PC make the PDF, so it matches your Word file exactly.<br>
        <ol style="margin:8px 0 8px 18px;padding:0"><li>Open the <b>native</b> folder inside your ApplyMate folder and double-click <b>install.bat</b>.</li>
        <li>Paste this extension ID when asked: <code id="extId">${chrome.runtime.id}</code> <button id="copyId">Copy</button></li>
        <li>Come back here and press <b>Try again</b>.</li></ol>
        <button class="pri" id="retry">Try again</button> <button id="approx">Use the quick preview instead (approximate)</button>`);
      $("#copyId").onclick = () => navigator.clipboard.writeText(chrome.runtime.id).catch(() => {});
      $("#retry").onclick = () => build();
      $("#approx").onclick = () => printFallback();
    } else {
      status(`Word couldn't make the PDF: ${AM.esc(e.message)}<br><br><button class="pri" id="retry">Try again</button> <button id="approx">Use the quick preview instead (approximate)</button>`, true);
      $("#retry").onclick = () => build();
      $("#approx").onclick = () => printFallback();
    }
  }
}

function showPdf(note = "") {
  if (note) $("#fileName").textContent = job.baseName + " (updated) · " + note;
  pdfUrl && URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
  $("#status").hidden = true;
  $("#pdfView").hidden = false;
  $("#pdfView").src = pdfUrl + "#view=FitH";
  $("#useBtn").disabled = false;
  $("#dlPdf").disabled = false;
}

/** Approximate path (no Word helper): browser render of the Word file → Chrome's print dialog (Save as PDF). */
async function printFallback(why = "") {
  await ensureRendered();
  $("#render").classList.add("showing");
  status(`${why ? why + "<br>" : ""}<b>Quick preview (approximate).</b> This is a browser rendering of your Word file; spacing can differ slightly from Word. For an exact PDF, set up the Word helper.<br>
    To save it: <b>Print / Save as PDF</b> → Destination “Save as PDF” → Save, then upload that PDF in ApplyMate → Profile.<br><br><button class="pri" id="doPrint">Print / Save as PDF</button>`);
  $("#doPrint").onclick = () => window.print();
}

let rendered = false;
async function ensureRendered() {
  if (rendered) return;
  const rec = await AM.get("file:" + job.docxFileId);
  const docx = b64ToBytes(rec.data);
  // keep Word's own page breaks and layout; don't reflow anything for print
  await renderAsync(docx.buffer, $("#render"), null, { className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true, experimental: true, ignoreWidth: false, ignoreHeight: false });
  // Latin-only resume: never let stray right-to-left settings in the file flip the text
  if (!/[֐-ࣿ]/.test(job.text || $("#render").innerText)) {
    const st = document.createElement("style");
    st.textContent = "#render, #render * { direction: ltr !important; unicode-bidi: normal !important; }";
    document.head.appendChild(st);
  }
  pageCss();
  await document.fonts.ready;
  await sleep(150);
  rendered = true;
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
  window.__AM_previewReady = true;
  window.__AM_approx = printFallback; // used by the test page
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
