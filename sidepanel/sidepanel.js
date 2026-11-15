import * as AI from "../lib/ai.js";
import { inspectDocx, addSkills } from "../lib/resumedocx.js";
import { pdfText, heuristicParse } from "../lib/resume.js";
import { resumeData, resumePdf, resumeDocx, letterPdf, pdfBase64, download } from "../lib/docs.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = AM.esc;
const view = $("#view");
const S = {
  tab: "job", profile: null, settings: null, apps: [], answers: [], contacts: [], files: [],
  tabInfo: null, job: null, li: null, hasForm: false, pageState: "loading", jobState: {}, lastFill: null,
  trackerView: "list", trackerQ: "", trackerStatus: "", detailId: null, inboundOpen: false, iq: null,
  contactQ: "", contactOpen: null, addContactOpen: false, draft: {}, tailor: null, qa: { q: "", a: "" }, answerQ: "",
  pending: null, // AI prompt copied, waiting for the user to paste the reply: {task, label, jobKey, tabId, job, extra}
  nano: "unsupported", keywords: null,
};

// ---------- utils ----------
let flashT;
function flash(msg, err = false) {
  const f = $("#flash");
  f.textContent = msg;
  f.className = err ? "err" : "";
  f.hidden = false;
  clearTimeout(flashT);
  flashT = setTimeout(() => (f.hidden = true), err ? 7000 : 3500);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label ?? v)}</option>`;
const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const blobToB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
const b64ToBlob = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
/** show skills the way the user wrote them ("TypeScript", not "typescript") */
const pretty = (canonList) => canonList.map((c) => AM.splitList(S.profile.skills).find((s) => AM.canonSkill(s) === c) || c);
const safeName = (s) => String(s || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 40);

async function loadData() {
  [S.profile, S.settings, S.apps, S.answers, S.contacts, S.files] = await Promise.all([
    AM.getProfile(), AM.getSettings(), AM.getApps(), AM.get("answers", []), AM.get("contacts", []), AM.get("files", []),
  ]);
  S.queue = await AM.get("resumeQueue", []);
  // your Word resume: which skill lines it has (Frontend / Backend / DevOps …)
  if (S.profile.sourceDocxId && (!S.docx || S.docx.id !== S.profile.sourceDocxId)) {
    try {
      const rec = await AM.get("file:" + S.profile.sourceDocxId);
      S.docx = rec ? { id: S.profile.sourceDocxId, name: rec.name, ...(await inspectDocx(await b64ToBlob(rec.data, rec.type).arrayBuffer())) } : null;
    } catch (e) { S.docx = { id: S.profile.sourceDocxId, error: e.message, lines: [], text: "" }; }
  }
  if (!S.profile.sourceDocxId) S.docx = null;
  const overdue = S.apps.filter(AM.isOverdue).length;
  const b = $("#overdueBadge");
  b.hidden = !overdue;
  b.textContent = overdue;
}
const saveProfile = debounce(() => AM.set("profile", S.profile), 350);
const saveApps = () => AM.set("apps", S.apps);
const saveContacts = () => AM.set("contacts", S.contacts);

async function saveFile(name, type, b64, kind, extra = {}) {
  const id = AM.uid();
  await AM.set("file:" + id, { name, type, data: b64 });
  S.files = [{ id, name, type, kind, createdAt: new Date().toISOString(), size: Math.round((b64.length * 3) / 4), ...extra }, ...S.files];
  await AM.set("files", S.files);
  return id;
}

// ---------- current tab / job ----------
async function loadJob() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  S.tabInfo = tab;
  S.job = null; S.li = null; S.hasForm = false; S.tailor = null; S.lastFill = null; S.qa = { q: "", a: "" };
  if (!tab || !/^https?:/.test(tab.url || "")) { S.pageState = "nopage"; return render(); }
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.__AM_detect ? { job: window.__AM_detect.getJobInfo(), li: window.__AM_detect.getLinkedInProfile() } : null),
    });
    if (!r || !r.result) { S.pageState = "reload"; return render(); }
    S.job = r.result.job;
    S.li = r.result.li;
    try {
      const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => (window.__AM_detect ? window.__AM_detect.looksLikeApplicationForm() : false) });
      S.hasForm = frames.some((f) => f.result);
    } catch {
      S.hasForm = false; // some frame (ads, sandboxed) refused; the job itself was read fine
    }
    S.jobState = await AM.get("jobState:" + AM.jobKey(S.job.url), {});
    if (S.jobState.title) S.job.title = S.jobState.title;
    if (S.jobState.company) S.job.company = S.jobState.company;
    S.keywords = S.jobState.keywords || null;
    if (S.jobState.tailor) S.tailor = { sel: {}, ...S.jobState.tailor };
    if (S.jobState.qa) S.qa = { ...S.jobState.qa };
    S.pageState = "ok";
    if (S.jobState.needCoverFile) { await makeCoverFile(); await saveJobState({ needCoverFile: false }); }
    await syncFillOptions();
  } catch (e) {
    S.pageState = "blocked";
  }
  render();
}
async function saveJobState(patch) {
  Object.assign(S.jobState, patch);
  await AM.set("jobState:" + AM.jobKey(S.job.url), S.jobState);
  await syncFillOptions();
}
function fillOptions() {
  const js = S.jobState || {};
  return {
    resumeFileId: js.resumeFileId || S.profile.defaultResumeId || "",
    coverLetter: js.useCover ? js.coverLetter || "" : "",
    coverLetterFileId: js.useCover ? js.coverFileId || "" : "",
    company: S.job ? S.job.company : "",
    role: S.job ? S.job.title : "",
  };
}
async function syncFillOptions() {
  if (S.tabInfo) await chrome.storage.session.set({ ["fill:" + S.tabInfo.id]: fillOptions() });
}
const currentApp = () => S.job && (S.apps.find((a) => a.jobKey === AM.jobKey(S.job.url)) || S.apps.find((a) => AM.norm(a.company) === AM.norm(S.job.company) && AM.norm(a.role) === AM.norm(S.job.title)));
const jobFromApp = (a) => ({ title: a.role, company: a.company, url: a.url || "", location: a.location || "", description: a.jd || "" });

// ---------- render ----------
function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  if (!S.profile) return;
  view.innerHTML = renderPending() + { job: renderJob, tracker: renderTracker, contacts: renderContacts, answers: renderAnswers, profile: renderProfile, settings: renderSettings }[S.tab]();
}

/** The "paste the AI reply here" card, shown on every tab while a prompt is waiting. */
function renderPending() {
  const p = S.pending;
  if (!p) return "";
  const site = AI.SITES[S.settings.aiSite] || AI.SITES.claude;
  return `<div class="card stack" style="border-color:var(--accent)">
    <div class="row between"><b>${esc(p.label)}${p.job && p.job.company ? " · " + esc(p.job.company) : ""}</b><button class="ghost sm" data-act="aiCancel" title="Cancel">✕</button></div>
    ${p.copied === false ? `<div class="small" style="color:var(--warn)">Copy didn't work automatically. Select all in this box (<span class="kbd">Ctrl+A</span>, <span class="kbd">Ctrl+C</span>):</div><textarea readonly rows="4" data-selectall>${esc(pendingPrompt())}</textarea>` : ""}
    <ol class="small" style="margin:0;padding-left:18px">
      <li>${p.copied === false ? "Copy the prompt above. Then in" : "Prompt copied ✓. In"} ${esc(site.label)}, paste it (<span class="kbd">Ctrl+V</span>) and send.</li>
      <li>Copy the <b>whole</b> reply and paste it below.</li></ol>
    <textarea id="aiReply" rows="6" placeholder="Paste the AI reply here (with the ===SECTION=== markers)…"></textarea>
    <div class="row"><button class="pri" data-act="aiApply">Use this reply</button><button class="sm" data-act="aiRecopy">Copy prompt again</button><button class="sm ghost" data-act="aiOpenSite">Open ${esc(site.label)}</button></div>
    <div class="small muted">The prompt holds your profile and this job. You choose where to paste it; nothing is sent automatically.</div>
  </div>`;
}
const pendingPrompt = () => {
  const p = S.pending;
  return AI.buildPrompt(p.task, { profile: S.profile, job: p.job, ...p.extra, contact: S.contacts.find((x) => x.id === p.extra.contactId) });
};
const aiBtn = (task, label, extra = "") => `<button data-act="aiCopy" data-task="${task}" ${extra} title="Copies a ready prompt and opens your AI chat. Free, no API key.">✨ ${label}</button>`;

function needProfileBanner() {
  if (S.profile.email && S.profile.firstName) return "";
  return `<div class="card" style="border-color:var(--accent)"><b>Start here:</b> upload your resume in <a href="#" data-act="goTab" data-tab="profile">Profile</a> so ApplyMate can fill forms and score jobs.</div>`;
}

function renderJob() {
  const banner = needProfileBanner();
  if (S.pageState === "loading") return banner + `<div class="card empty">Reading this page…</div>`;
  if (S.pageState === "nopage" || S.pageState === "blocked")
    return banner + `<div class="card empty">Open a job posting or application form (LinkedIn, Naukri, Indeed, a company careers page…) and ApplyMate will read it here.<br><br><button data-act="openSearches" class="pri">Open today's searches</button></div>`;
  if (S.pageState === "reload") return banner + `<div class="card empty">ApplyMate was installed after this tab opened.<br><button class="pri" data-act="reloadTab" style="margin-top:8px">Reload this page</button></div>`;
  const j = S.job;
  const sc = AM.scoreJob(S.profile, j, S.settings.prefs);
  const app = currentApp();
  const resumes = S.files.filter((f) => f.kind === "resume" || f.kind === "tailored");
  const nano = S.nano === "available";
  const liCard = S.li
    ? `<div class="card stack"><h3>LinkedIn profile</h3><div><b>${esc(S.li.name)}</b><div class="muted small">${esc(S.li.headline)}</div></div>
       <div class="grid2"><label class="f">Company<input id="liCompany" value="${esc(S.li.company)}"></label>
       <label class="f">Relationship<select id="liRel">${["Alumni", "Ex-colleague", "Friend", "Recruiter", "Cold"].map((r) => opt(r, "Cold")).join("")}</select></label></div>
       <button class="pri" data-act="saveLiContact">Save as referral contact</button></div>`
    : "";
  const jobLooks = j.looksLikeJob || S.hasForm;
  return `${banner}${liCard}
  <div class="card stack">
    <div class="row between"><div class="grow">
      <input class="t" data-bind="jobField" data-k="title" value="${esc(j.title)}" title="Job title (edit if wrong)" style="font-weight:650;border-color:transparent;padding:2px 4px">
      <input data-bind="jobField" data-k="company" value="${esc(j.company)}" title="Company (edit if wrong)" style="border-color:transparent;padding:2px 4px">
      <div class="muted small" style="padding:0 4px">${esc(j.location || "")}${j.salary ? " · " + esc(j.salary) : ""} · <span title="How the job details were read">${esc(j.via)}</span> · <a href="#" data-act="reread" title="Re-read this page (if you switched jobs)">↻ re-read</a></div>
    </div>
    ${jobLooks ? `<div style="text-align:center"><div class="score">${sc.score}</div><span class="pill ${sc.label.split(" ")[0]}">${sc.label}</span></div>` : ""}</div>
    ${!jobLooks ? `<div class="muted small">This page doesn't look like a job posting. You can still fill forms or save it.</div>` : ""}
    <div class="row">
      <button class="pri" data-act="fill" ${S.hasForm ? "" : 'title="No application form detected; it will try anyway"'}>Fill form</button>
      ${app ? `<select data-bind="appStatus" style="width:auto">${AM.STATUSES.map((s) => opt(s, app.status)).join("")}</select>` : `<button data-act="saveJob">Save job</button>`}
      ${!app || app.status === "Saved" ? `<button data-act="markApplied">Mark applied</button>` : ""}
      <button class="ghost sm" data-act="saveAnswers" title="Save answers you typed on this page to the answer bank">Save typed answers</button>
    </div>
    ${S.lastFill ? `<div class="small">Filled <b>${S.lastFill.filled}</b>${S.lastFill.review ? `, <span style="color:var(--warn)">${S.lastFill.review} to check</span>` : ""}${S.lastFill.suggested ? `<br><span style="color:var(--warn)">Chat answer suggested (outlined): click it yourself to send.</span>` : ""}${S.lastFill.missing.length ? `<br><span style="color:var(--bad)">Required, still empty:</span> ${S.lastFill.missing.slice(0, 6).map(esc).join(" · ")}` : ""}<br><span class="muted">Review the form, then submit it yourself.</span></div>
      ${S.lastFill.unanswered.length ? `<div class="stack small" style="border:1px dashed var(--accent);border-radius:8px;padding:8px">
        <div><b>${S.lastFill.unanswered.length} question${S.lastFill.unanswered.length > 1 ? "s" : ""} your profile can't answer</b> (${S.lastFill.unanswered.filter((u) => u.required).length} required <span style="color:var(--bad)">red</span>, ${S.lastFill.unanswered.filter((u) => !u.required).length} optional <span style="color:#2563eb">blue dashed</span>)</div>
        <details><summary class="small">Show them</summary><ol style="margin:4px 0;padding-left:18px">${S.lastFill.unanswered.map((u) => `<li>${esc(u.question)}${u.options.length ? ` <span class="muted">(${esc(u.options.slice(0, 5).join(" / "))}${u.options.length > 5 ? "…" : ""})</span>` : ""}</li>`).join("")}</ol></details>
        <div class="row">${aiBtn("questions", "Answer the rest with AI")}</div>
        <div class="muted">Answers you approve are filled in and saved to your answer bank, so next time they fill automatically.</div>
      </div>` : ""}` : ""}
    <label class="f">Resume to attach for this job
      <select data-bind="jobResume">${resumes.length ? resumes.map((f) => opt(f.id, S.jobState.resumeFileId || S.profile.defaultResumeId, (f.kind === "tailored" ? "✦ " : "") + f.name)).join("") : `<option value="">Upload a resume in Profile first</option>`}</select></label>
  </div>

  ${jobLooks ? `<div class="card stack">
    <h3>Match</h3>
    ${sc.matched.length ? `<div><span class="small muted">You have:</span> ${sc.matched.map((s) => `<span class="chip ok">${esc(AM.skillLabel(s))}</span>`).join("")}</div>` : ""}
    ${sc.missing.length ? `<div><span class="small muted">Skills this job asks for that aren't on your resume. Add only the ones you've really used:</span><div>${sc.missing.map((s) => `<span class="chip bad">${esc(AM.skillLabel(s))} <a href="#" data-act="addSkill" data-skill="${esc(AM.skillLabel(s))}" title="Add to the Skills section of your resume">+ Add</a></span>`).join("")}</div></div>` : ""}
    ${sc.flags.length ? sc.flags.map((f) => `<div class="chip warn">⚠ ${esc(f)}</div>`).join("") : ""}
    ${sc.highlights.length ? `<details><summary class="small">Key requirements in this job (${sc.highlights.filter((h) => !h.missing.length).length}/${sc.highlights.length} met)</summary><ul class="small" style="margin:6px 0;padding-left:16px">${sc.highlights.map((h) => `<li>${h.missing.length ? "✗" : "✓"} ${esc(h.text)}${h.missing.length ? ` <span style="color:var(--bad)">(${esc(h.missing.map(AM.skillLabel).join(", "))})</span>` : ""}</li>`).join("")}</ul></details>` : ""}
    ${!S.settings.prefs.roles ? `<div class="small muted">Tip: set target roles & locations in <a href="#" data-act="goTab" data-tab="settings">Settings</a> for better scores.</div>` : ""}
    ${nano && !S.keywords ? `<button class="sm" data-act="nanoKeywords">Extract key requirements (on-device AI)</button>` : ""}
    ${S.keywords ? `<div><span class="small muted">Key requirements:</span> ${S.keywords.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}
  </div>` : ""}
  ${renderResumeUpdate(true)}

  <div class="card stack">
    <details ${S.tailor ? "open" : ""}><summary>Tailor resume to this job</summary><div class="stack">${renderTailor(sc)}</div></details>
    <details ${S.jobState.coverLetter ? "open" : ""}><summary>Cover letter</summary><div class="stack">${renderCover()}</div></details>
    <details><summary>Answer a screening question</summary><div class="stack">
      <textarea id="qaQ" placeholder="Paste a question from the form, e.g. 'Why do you want to join us?'">${esc(S.qa.q)}</textarea>
      <div class="row"><button data-act="qaDraft">Find in answer bank</button>${nano ? `<button data-act="qaNano" title="Short factual answers, runs on your computer">Answer on-device</button>` : ""}${aiBtn("answer", "Copy AI prompt")}</div>
      ${S.qa.a ? `<textarea id="qaA">${esc(S.qa.a)}</textarea><div class="row"><button data-act="qaCopy">Copy</button><button data-act="qaSave">Save to answer bank</button></div>` : ""}
    </div></details>
    <details><summary>Referrals & HR at ${esc(j.company || "this company")}</summary><div class="stack">${renderPeople(j)}</div></details>
  </div>`;
}

function renderTailor(sc) {
  const p = S.profile;
  const t = S.tailor;
  let h = `<div class="row"><button data-act="kwTailor">Quick tailor (offline)</button>${aiBtn("tailor", "Copy AI prompt")}</div>`;
  if (!(p.experience || []).length) h += `<div class="small muted">Add your work experience in Profile to get bullet-level tailoring.</div>`;
  if (!t) return h;
  const box = (id, label, oldV, newV) =>
    `<label class="diff"><div class="row"><input type="checkbox" data-tsel="${id}" ${t.sel[id] !== false ? "checked" : ""}> <b>${esc(label)}</b></div>${oldV ? `<div class="old">${esc(oldV)}</div>` : ""}<div>${newV}</div></label>`;
  h += box("summary", "Summary", t.summary !== p.summary ? p.summary : "", esc(t.summary || ""));
  h += box("skills", "Skills (reordered for this job)", "", t.skills.map((s) => `<span class="chip ${sc.matched.includes(AM.canonSkill(s)) ? "ok" : ""}">${esc(s)}</span>`).join(""));
  (p.experience || []).forEach((e, i) => {
    if (!t.experience[i]) return;
    h += box("exp:" + i, `${e.title} · ${e.company}`, "", `<ul style="margin:2px 0;padding-left:16px">${t.experience[i].map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`);
  });
  (p.projects || []).forEach((e, i) => {
    if (!t.projects[i]) return;
    h += box("proj:" + i, `Project: ${e.name}`, "", `<ul style="margin:2px 0;padding-left:16px">${t.projects[i].map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`);
  });
  if (t.notes && t.notes.length) h += `<div class="small">${t.notes.map((n) => `<div>💡 ${esc(n)}</div>`).join("")}</div>`;
  h += `<div class="small muted">Untick anything you don't want. Original facts only: check every line before sending.</div>
  <div class="row"><button class="pri" data-act="useTailored">Use for this job</button><button data-act="dlTailored" data-fmt="pdf">PDF</button><button data-act="dlTailored" data-fmt="docx">DOCX</button></div>`;
  return h;
}

function renderCover() {
  const js = S.jobState;
  return `<div class="row"><select id="coverTone" style="width:auto">${["formal", "concise", "enthusiastic"].map((t) => opt(t, js.coverTone || "concise")).join("")}</select>
    <button data-act="genCoverTpl">From template</button>${aiBtn("cover", "Copy AI prompt")}</div>
    ${js.coverLetter !== undefined && js.coverLetter !== "" ? `<textarea data-bind="coverText" rows="10">${esc(js.coverLetter)}</textarea>
    <label class="row small"><input type="checkbox" data-bind="useCover" ${js.useCover ? "checked" : ""}> Fill this into “cover letter / why us” boxes and cover-letter uploads</label>
    <div class="row"><button data-act="copyCover">Copy</button><button data-act="dlCover">Download PDF</button></div>` : ""}`;
}

function renderPeople(j) {
  if (!j.company) return `<div class="muted">Set the company name above first.</div>`;
  const links = AM.peopleLinks(j.company, S.profile, j.title);
  const mine = S.contacts.filter((c) => c.company && (AM.norm(c.company).includes(AM.norm(j.company)) || AM.norm(j.company).includes(AM.norm(c.company))));
  return `<div class="small muted">Opens searches in new tabs. Browse, then right-click a LinkedIn profile → “ApplyMate: save this person”.</div>
  <div class="row">${links.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank">${esc(l.label)} ↗</a>`).join("")}</div>
  ${(j.contacts || []).length ? `<div><b class="small">Found on this posting</b>${j.contacts.map((c, i) => `<div class="row small"><span class="grow">${esc(c.name || "")} ${esc(c.email || "")}</span><button class="sm" data-act="saveJobContact" data-i="${i}">Save</button></div>`).join("")}</div>` : ""}
  ${mine.length ? `<div><b class="small">Your contacts here</b>${mine.map((c) => `<div class="row small"><a href="#" class="grow" data-act="openContact" data-id="${c.id}">${esc(c.name)}</a><span class="pill ${c.status === "Referred" ? "Offer" : "Saved"}">${esc(c.status)}</span></div>`).join("")}</div>` : `<div class="small muted">No contacts saved at ${esc(j.company)} yet.</div>`}`;
}

// ----- tracker -----
function renderTracker() {
  if (S.detailId) return renderAppDetail();
  const weekAgo = AM.addDays(AM.today(), -7);
  const applied = S.apps.filter((a) => a.status !== "Saved");
  const responded = applied.filter((a) => a.timeline.some((t) => ["Screening", "Interview", "Offer", "Rejected"].includes(t.status)));
  const stats = [
    [S.apps.filter((a) => a.appliedOn && a.appliedOn >= weekAgo).length, "applied (7d)"],
    [S.apps.filter((a) => AM.ACTIVE.has(a.status)).length, "active"],
    [S.apps.filter((a) => a.status === "Interview" || (a.rounds || []).length).length, "interviews"],
    [applied.length ? Math.round((responded.length / applied.length) * 100) + "%" : "–", "response rate"],
  ];
  const q = AM.norm(S.trackerQ);
  const list = S.apps.filter((a) => (!S.trackerStatus || (S.trackerStatus === "Overdue" ? AM.isOverdue(a) : a.status === S.trackerStatus)) && (!q || AM.norm(a.company + " " + a.role).includes(q)));
  const card = (a) => {
    const refs = S.contacts.filter((c) => c.appId === a.id || (c.company && AM.norm(c.company) === AM.norm(a.company)));
    const ref = refs.find((c) => c.status === "Referred") ? "Referred" : refs.find((c) => c.status === "Request sent") ? "Referral pending" : "";
    return `<div class="item" data-act="openApp" data-id="${a.id}" draggable="true" data-drag="${a.id}">
      <div class="row between"><span class="t grow">${esc(a.company || "—")}</span><span class="pill ${a.status}">${a.status}</span></div>
      <div class="small">${esc(a.role || "")}</div>
      <div class="small muted">${a.appliedOn ? "Applied " + fmtDate(a.appliedOn) : "Saved " + fmtDate(a.createdAt)}${a.followUp && AM.ACTIVE.has(a.status) ? ` · <span class="${AM.isOverdue(a) ? "overdue" : ""}">follow up ${fmtDate(a.followUp)}</span>` : ""}${a.source === "Inbound" ? " · inbound" : ""}${ref ? ` · <span class="chip ${ref === "Referred" ? "ok" : "warn"}">${ref}</span>` : ""}</div>
    </div>`;
  };
  const inbound = S.inboundOpen
    ? `<div class="card stack"><h3>Recruiter reached out</h3>
      <div class="grid2"><label class="f">Recruiter name<input id="inName"></label><label class="f">Company<input id="inCompany"></label>
      <label class="f">Role<input id="inRole"></label><label class="f">Phone / email<input id="inContact"></label>
      <label class="f">CTC discussed<input id="inCtc"></label><label class="f">Channel<select id="inChannel">${["Call", "Email", "WhatsApp", "LinkedIn", "Naukri"].map((c) => opt(c)).join("")}</select></label></div>
      <label class="f">Next step<input id="inNext" placeholder="e.g. Technical round on Monday"></label>
      <div class="row"><button class="pri" data-act="saveInbound">Add</button><button class="ghost" data-act="toggleInbound">Cancel</button></div></div>`
    : "";
  return `<div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("")}</div>
  ${inbound}
  <div class="row"><input class="grow" style="width:auto" placeholder="Search company / role" data-bind="trackerQ" value="${esc(S.trackerQ)}">
    <select data-bind="trackerStatus" style="width:auto">${opt("", S.trackerStatus, "All")}${opt("Overdue", S.trackerStatus, "⏰ Follow-up due")}${AM.STATUSES.map((s) => opt(s, S.trackerStatus)).join("")}</select></div>
  <div class="row between"><div class="row"><button class="sm ${S.trackerView === "list" ? "pri" : ""}" data-act="trackerView" data-v="list">List</button><button class="sm ${S.trackerView === "board" ? "pri" : ""}" data-act="trackerView" data-v="board">Board</button></div>
    <div class="row"><button class="sm" data-act="toggleInbound">+ Recruiter call</button><button class="sm" data-act="exportCsv">CSV</button></div></div>
  ${!S.apps.length ? `<div class="card empty">No applications yet. Save a job or press “Mark applied” on a posting. One-click applies on Naukri / LinkedIn are logged automatically.</div>` : ""}
  ${S.trackerView === "list"
      ? `<div class="list">${list.map(card).join("")}</div>`
      : `<div class="board">${AM.STATUSES.map((s) => `<div class="col" data-drop="${s}"><h4>${s}<span class="muted">${list.filter((a) => a.status === s).length}</span></h4>${list.filter((a) => a.status === s).map(card).join("")}</div>`).join("")}</div>`}`;
}

function renderAppDetail() {
  const a = S.apps.find((x) => x.id === S.detailId);
  if (!a) { S.detailId = null; return renderTracker(); }
  const refs = S.contacts.filter((c) => c.appId === a.id || (c.company && AM.norm(c.company) === AM.norm(a.company)));
  const f = (k, label, type = "text") => `<label class="f">${label}<input type="${type}" data-bind="appField" data-k="${k}" value="${esc(a[k] || "")}"></label>`;
  return `<div class="row"><button class="ghost sm" data-act="closeApp">← Back</button>${a.url ? `<a href="${esc(a.url)}" target="_blank" class="small">Open posting ↗</a>` : ""}</div>
  <div class="card stack">
    <div class="grid2">${f("company", "Company")}${f("role", "Role")}</div>
    <div class="grid2"><label class="f">Status<select data-bind="appStatusDetail">${AM.STATUSES.map((s) => opt(s, a.status)).join("")}</select></label>${f("followUp", "Follow-up date", "date")}</div>
    <div class="grid2">${f("appliedOn", "Applied on", "date")}<label class="f">Source<select data-bind="appField" data-k="source">${["Portal", "Company site", "Referral", "Inbound", "Other"].map((s) => opt(s, a.source)).join("")}</select></label></div>
    <div class="grid2">${f("contactPerson", "Contact person")}${f("salary", "Salary discussed")}</div>
    ${f("location", "Location")}
    <label class="f">Notes / responses<textarea data-bind="appField" data-k="notes">${esc(a.notes || "")}</textarea></label>
    ${a.resumeName ? `<div class="small muted">Resume sent: ${esc(a.resumeName)}</div>` : ""}
    ${a.coverLetter ? `<details><summary class="small">Cover letter sent</summary><div class="small" style="white-space:pre-wrap">${esc(a.coverLetter)}</div></details>` : ""}
    <div><b class="small">Timeline</b><ul class="timeline">${a.timeline.map((t) => `<li>${fmtDate(t.at)}: ${esc(t.status)}${t.note ? ", " + esc(t.note) : ""}</li>`).join("")}</ul></div>
  </div>
  <div class="card stack"><h3>Interview rounds</h3>
    ${(a.rounds || []).map((r) => `<div class="row small"><span class="grow"><b>${esc(r.name)}</b> · ${r.at ? new Date(r.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}${r.notes ? "<br>" + esc(r.notes) : ""}</span><button class="sm danger" data-act="delRound" data-id="${r.id}">✕</button></div>`).join("") || `<div class="small muted">No rounds yet. You'll get a reminder 24h before each one.</div>`}
    <div class="grid2"><input id="rName" placeholder="Round (e.g. DSA, HM)"><input id="rAt" type="datetime-local"></div>
    <input id="rNotes" placeholder="Notes (interviewer, link…)"><button data-act="addRound">Add round</button>
  </div>
  <div class="card stack"><h3>Interview prep</h3>
    <textarea data-bind="appField" data-k="prep" rows="6" placeholder="Questions asked, what to revise, your questions for them…">${esc(a.prep || "")}</textarea>
    <div class="row">${aiBtn("interview", "Likely questions: copy AI prompt", `data-app="${a.id}"`)}</div>
    ${S.iq && S.iq.id === a.id ? `<div class="stack small">${S.iq.questions.map((q) => `<div><b>${esc(q.q)}</b><div class="muted">${esc(q.why)}</div><div>💡 ${esc(q.tip)}</div></div>`).join("")}<button class="sm" data-act="iqToPrep">Add to prep notes</button></div>` : ""}
  </div>
  <div class="card stack"><h3>Referrals at ${esc(a.company)}</h3>
    ${refs.map((c) => `<div class="row small"><a href="#" class="grow" data-act="openContact" data-id="${c.id}">${esc(c.name)}</a><span class="chip">${esc(c.status)}</span></div>`).join("") || `<div class="small muted">No contacts yet.</div>`}
    <div class="row">${AM.peopleLinks(a.company, S.profile, a.role).slice(0, 4).map((l) => `<a class="chip" target="_blank" href="${esc(l.url)}">${esc(l.label)} ↗</a>`).join("")}</div>
  </div>
  <button class="danger" data-act="delApp">Delete application</button>`;
}

// ----- contacts -----
function contactVars(c, job) {
  const p = S.profile;
  const sc = job.description ? AM.scoreJob(p, job, S.settings.prefs) : { matched: [] };
  const skills = (sc.matched.length ? pretty(sc.matched) : AM.splitList(p.skills)).slice(0, 3);
  const bullets = (p.experience || []).flatMap((e) => e.bullets || []).slice(0, 3);
  return {
    first: (c.name || "").split(" ")[0], title: p.currentTitle || "developer", exp: p.totalExperience || "a few", skills: skills.join(", "),
    role: job.title || "open", company: c.company || job.company, url: job.url || "", me: AM.profileValue(p, "fullName"), phone: p.phone, notice: p.noticePeriod || "?",
    point1: `${p.totalExperience || "Several"} years as ${p.currentTitle || "a developer"}${p.currentCompany ? " at " + p.currentCompany : ""}`,
    point2: bullets[0] || `Hands-on with ${skills.join(", ")}`, point3: bullets[1] || `Notice period: ${p.noticePeriod || "flexible"} days`,
  };
}
function jobForContact(c) {
  const app = S.apps.find((a) => a.id === c.appId) || S.apps.find((a) => AM.norm(a.company) === AM.norm(c.company));
  if (app) return jobFromApp(app);
  if (S.job && AM.norm(S.job.company) === AM.norm(c.company)) return S.job;
  return { title: "", company: c.company, url: "", description: "" };
}
function renderContacts() {
  const q = AM.norm(S.contactQ);
  const list = S.contacts.filter((c) => !q || AM.norm(`${c.name} ${c.company} ${c.headline}`).includes(q));
  const groups = {};
  for (const c of list) (groups[c.company || "No company"] = groups[c.company || "No company"] || []).push(c);
  const companyApps = q ? S.apps.filter((a) => AM.norm(a.company).includes(q)) : [];
  const add = S.addContactOpen
    ? `<div class="card stack"><h3>Add contact</h3><div class="grid2">
      <label class="f">Name<input id="cName"></label><label class="f">Company<input id="cCompany" value="${esc(S.job && S.tab === "contacts" ? S.job.company : "")}"></label>
      <label class="f">Headline / role<input id="cHeadline"></label><label class="f">Relationship<select id="cRel">${["Alumni", "Ex-colleague", "Friend", "Recruiter", "Cold"].map((r) => opt(r)).join("")}</select></label>
      <label class="f">LinkedIn URL<input id="cUrl"></label><label class="f">Email / phone<input id="cEmail"></label></div>
      <div class="row"><button class="pri" data-act="addContact">Add</button><button class="ghost" data-act="toggleAddContact">Cancel</button></div></div>`
    : "";
  const item = (c) => {
    const open = S.contactOpen === c.id;
    const due = c.followUp && c.followUp <= AM.today() && c.status === "Request sent";
    let h = `<div class="item" ${open ? 'style="cursor:default"' : `data-act="openContact" data-id="${c.id}"`}>
      <div class="row between"><span class="t grow">${esc(c.name)}</span><span class="chip">${esc(c.relationship || "")}</span><span class="pill ${c.status === "Referred" ? "Offer" : c.status === "Declined" || c.status === "No reply" ? "Rejected" : "Saved"}">${esc(c.status)}</span></div>
      <div class="small muted">${esc(c.headline || "")}${c.followUp && c.status === "Request sent" ? ` · <span class="${due ? "overdue" : ""}">follow up ${fmtDate(c.followUp)}</span>` : ""}</div>`;
    if (open) {
      const job = jobForContact(c);
      const d = S.draft[c.id] || { kind: "referral", text: "" };
      const appsAt = S.apps.filter((a) => AM.norm(a.company) === AM.norm(c.company));
      h += `<div class="stack" style="margin-top:8px">
        <div class="grid2"><label class="f">Status<select data-bind="contactField" data-k="status" data-id="${c.id}">${AM.CONTACT_STATUSES.map((s) => opt(s, c.status)).join("")}</select></label>
        <label class="f">Follow up on<input type="date" data-bind="contactField" data-k="followUp" data-id="${c.id}" value="${esc(c.followUp || "")}"></label>
        <label class="f">Company<input data-bind="contactField" data-k="company" data-id="${c.id}" value="${esc(c.company || "")}"></label>
        <label class="f">For application<select data-bind="contactField" data-k="appId" data-id="${c.id}">${opt("", c.appId, "—")}${appsAt.map((a) => opt(a.id, c.appId, a.role)).join("")}</select></label>
        <label class="f">Email / phone<input data-bind="contactField" data-k="email" data-id="${c.id}" value="${esc(c.email || "")}"></label>
        <label class="f">Channel<select data-bind="contactField" data-k="channel" data-id="${c.id}">${["LinkedIn", "Email", "WhatsApp", "Call", "In person"].map((s) => opt(s, c.channel)).join("")}</select></label></div>
        <label class="f">Notes<textarea data-bind="contactField" data-k="notes" data-id="${c.id}" rows="2">${esc(c.notes || "")}</textarea></label>
        ${c.url ? `<a href="${esc(c.url)}" target="_blank" class="small">Open LinkedIn profile ↗</a>` : ""}
        <hr><b class="small">Draft a message${job.title ? " about " + esc(job.title) : ""}</b>
        <div class="row"><select data-bind="draftKind" data-id="${c.id}" style="width:auto">${[["connect", "Connection note"], ["referral", "Referral request"], ["hr", "Note to HR"], ["followup", "Follow-up"]].map(([v, l]) => opt(v, d.kind, l)).join("")}</select>
          <button class="sm" data-act="draftTpl" data-id="${c.id}">Template</button>${aiBtn("outreach", "Copy AI prompt", `data-contact="${c.id}"`)}</div>
        ${d.text ? `<textarea data-bind="draftText" data-id="${c.id}" rows="6">${esc(d.text)}</textarea><div class="small muted">${d.text.length} chars${d.kind === "connect" && d.text.length > 300 ? ' · <span class="overdue">LinkedIn notes max 300</span>' : ""}</div>
          <div class="row"><button class="sm" data-act="copyDraft" data-id="${c.id}">Copy</button><button class="sm pri" data-act="markSent" data-id="${c.id}">I sent it: remind me in 5 days</button></div>` : ""}
        <div class="row between"><button class="sm ghost" data-act="closeContact">Close</button><button class="sm danger" data-act="delContact" data-id="${c.id}">Delete</button></div>
      </div>`;
    }
    return h + "</div>";
  };
  return `${add}
  <div class="row"><input class="grow" style="width:auto" placeholder="Search name or company" data-bind="contactQ" value="${esc(S.contactQ)}"><button class="sm" data-act="toggleAddContact">+ Contact</button></div>
  ${companyApps.length ? `<div class="card small"><b>Applications matching “${esc(S.contactQ)}”</b>${companyApps.map((a) => `<div class="row"><a href="#" class="grow" data-act="openAppFromContacts" data-id="${a.id}">${esc(a.company)}: ${esc(a.role)}</a><span class="pill ${a.status}">${a.status}</span></div>`).join("")}</div>` : ""}
  ${!S.contacts.length ? `<div class="card empty">Save people from LinkedIn profiles (right-click → “ApplyMate: save this person”), or use “Referrals & HR” on a job page to find them.</div>` : ""}
  ${Object.entries(groups).map(([co, cs]) => `<div class="stack"><div class="small muted" style="font-weight:600">${esc(co)}</div><div class="list">${cs.map(item).join("")}</div></div>`).join("")}`;
}

// ----- answers -----
function renderAnswers() {
  const q = AM.norm(S.answerQ);
  const list = S.answers.filter((a) => !q || AM.norm(a.q + " " + a.a).includes(q));
  return `<div class="card small muted">Answers you type into forms are saved here automatically and reused when a similar question shows up (marked amber so you can check). Use <span class="kbd">{company}</span> and <span class="kbd">{role}</span> as placeholders.</div>
  <div class="row"><input class="grow" style="width:auto" placeholder="Search answers" data-bind="answerQ" value="${esc(S.answerQ)}"><button class="sm" data-act="addAnswer">+ Answer</button></div>
  <div class="list">${list.map((a) => `<div class="card stack"><input data-bind="ansField" data-k="q" data-id="${a.id}" value="${esc(a.q)}" style="font-weight:600"><textarea data-bind="ansField" data-k="a" data-id="${a.id}" rows="3">${esc(a.a)}</textarea><div class="row between small muted"><span>Updated ${fmtDate(a.updatedAt)}</span><button class="sm danger" data-act="delAnswer" data-id="${a.id}">Delete</button></div></div>`).join("") || `<div class="card empty">No saved answers yet.</div>`}</div>`;
}

// ----- profile -----
const GROUPS = [
  ["Basics", ["firstName", "lastName", "email", "phone", "city", "state", "country", "pincode", "preferredLocations", "linkedin", "github", "portfolio"]],
  ["Current job", ["currentCompany", "currentTitle", "totalExperience", "relevantExperience"]],
  ["Pay & joining (India)", ["currentCTC", "expectedCTC", "noticePeriod", "noticeNegotiable", "lastWorkingDay", "relocate", "workMode"]],
  ["Education", ["degree", "college", "gradYear", "cgpa"]],
  ["Other", ["workAuth", "sponsorship", "gender", "dob", "address"]],
];
function profileInput(k) {
  const p = S.profile;
  const def = AM.FIELD_MAP[k] || { label: k === "noticeNegotiable" ? "Notice negotiable" : k, kind: k === "noticeNegotiable" ? "bool" : "text" };
  if (def.kind === "bool") return `<label class="f">${esc(def.label)}<select data-bind="profileField" data-k="${k}" data-type="bool">${opt("true", String(!!p[k]), "Yes")}${opt("false", String(!!p[k]), "No")}</select></label>`;
  if (k === "workMode") return `<label class="f">${esc(def.label)}<select data-bind="profileField" data-k="${k}">${["Remote", "Hybrid", "On-site", "Any"].map((v) => opt(v, p[k])).join("")}</select></label>`;
  if (k === "gender") return `<label class="f">${esc(def.label)}<select data-bind="profileField" data-k="${k}">${["Prefer not to say", "Male", "Female", "Non-binary"].map((v) => opt(v, p[k])).join("")}</select></label>`;
  const type = k === "dob" || k === "lastWorkingDay" ? "date" : k === "email" ? "email" : "text";
  return `<label class="f">${esc(def.label)}<input type="${type}" data-bind="profileField" data-k="${k}" value="${esc(p[k] ?? "")}"></label>`;
}
function renderRepeat(kind, fields) {
  const items = S.profile[kind] || [];
  return `${items.map((it, i) => `<div class="repeat stack"><div class="grid2">${fields.map(([k, l]) => `<label class="f">${l}<input data-bind="rep" data-kind="${kind}" data-i="${i}" data-k="${k}" value="${esc(it[k] || "")}"></label>`).join("")}</div>
    ${kind !== "education" ? `<label class="f">Bullets (one per line)<textarea data-bind="rep" data-kind="${kind}" data-i="${i}" data-k="bullets" rows="4">${esc((it.bullets || []).join("\n"))}</textarea></label>` : ""}
    <button class="sm danger" data-act="repDel" data-kind="${kind}" data-i="${i}">Remove</button></div>`).join("")}
    <button class="sm" data-act="repAdd" data-kind="${kind}">+ Add</button>`;
}
/** "Update my resume": skills queued for YOUR Word resume, the line each goes on, and Preview final PDF. */
function renderResumeUpdate(compact = false) {
  if (!S.queue.length && compact) return "";
  if (!S.docx) {
    if (!S.queue.length) return "";
    return `<div class="card stack" style="border-color:var(--accent)"><h3>Update my resume</h3>
      <div class="small">${S.queue.length} skill${S.queue.length > 1 ? "s" : ""} waiting: ${S.queue.map((q) => esc(q.skill)).join(", ")}.</div>
      <div class="small muted">Upload your <b>Word (.docx)</b> resume in Profile → Resume so ApplyMate can put them on the right line of your own resume.</div>
      ${compact ? `<a href="#" data-act="goTab" data-tab="profile" class="small">Go to Profile →</a>` : ""}</div>`;
  }
  if (S.docx.error) return `<div class="card small" style="border-color:var(--bad)">Couldn't read your Word resume: ${esc(S.docx.error)}</div>`;
  const lines = S.docx.lines;
  if (!lines.length) return `<div class="card stack"><h3>Update my resume</h3><div class="small">Couldn't find a Skills section in <b>${esc(S.docx.name)}</b>. Its heading should be something like “Skills” or “Technical Skills”.</div></div>`;
  const rows = S.queue.map((q, i) => {
    const auto = AM.placeSkill(q.skill, lines);
    const chosen = q.line !== null && q.line !== undefined && q.line !== "" ? +q.line : auto ? auto.index : "";
    return `<div class="row small" style="align-items:center"><b style="min-width:80px">${esc(q.skill)}</b> →
      <select data-bind="queueLine" data-i="${i}" style="width:auto;flex:1">${chosen === "" ? `<option value="" selected>Choose a line…</option>` : ""}${lines.map((l, li) => opt(li, chosen, `${l.label}: ${l.items.slice(0, 3).join(", ")}${l.items.length > 3 ? "…" : ""}`)).join("")}</select>
      <button class="sm danger" data-act="queueRemove" data-i="${i}" title="Remove">✕</button></div>
      ${auto && q.line === null ? `<div class="small muted" style="margin:-4px 0 4px 86px">${esc(auto.reason)}</div>` : ""}`;
  }).join("");
  return `<div class="card stack" style="border-color:var(--accent)"><h3>Update my resume</h3>
    <div class="small muted">Edits <b>${esc(S.docx.name)}</b>: adds each skill to the end of the chosen line, in your own formatting. The original file isn't changed.</div>
    ${rows || `<div class="small muted">No skills queued. Use “+ Add” on a job's Match card, or add one here.</div>`}
    ${compact ? "" : `<div class="row"><input id="queueNew" placeholder="Add a skill, e.g. Kubernetes" style="flex:1;width:auto"><button class="sm" data-act="queueAdd">Add</button></div>`}
    ${S.queue.length ? `<button class="pri" data-act="previewResume">Preview final PDF</button>` : ""}
  </div>`;
}

function renderProfile() {
  const p = S.profile;
  const files = S.files;
  return `${renderResumeUpdate()}<div class="card stack"><h3>Resume</h3>
    <label class="btn" style="text-align:center">Upload resume (PDF or Word .docx)<input type="file" accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" id="resumeUpload" hidden></label>
    <div class="small muted">Upload your <b>Word (.docx)</b> version too: then ApplyMate can add skills into <b>your own</b> resume, on the right line, and make the PDF.</div>
    ${files.length ? `<div class="list">${files.map((f) => `<div class="row small"><input type="radio" name="defres" data-bind="defaultResume" value="${f.id}" ${p.defaultResumeId === f.id ? "checked" : ""} ${f.kind === "cover" || f.kind === "resume-docx" ? "disabled" : ""} title="Default resume"><span class="grow">${f.kind === "tailored" ? "✦ " : f.kind === "cover" ? "✉ " : f.kind === "resume-docx" ? "📝 " : ""}${esc(f.name)}${f.id === p.sourceDocxId ? ' <span class="muted">(source for edits)</span>' : ""}</span><button class="sm" data-act="dlFile" data-id="${f.id}">↓</button><button class="sm danger" data-act="delFile" data-id="${f.id}">✕</button></div>`).join("")}</div><div class="small muted">● = default resume attached to forms. ✦ = tailored versions.</div>` : ""}
  </div>
  ${GROUPS.map(([g, keys]) => `<div class="card stack"><h3>${g}</h3><div class="grid2">${keys.map(profileInput).join("")}</div></div>`).join("")}
  <div class="card stack"><h3>Skills & summary</h3>
    <label class="f">Key skills (comma separated)<textarea data-bind="profileField" data-k="skills" rows="3">${esc(p.skills)}</textarea></label>
    <label class="f">Summary<textarea data-bind="profileField" data-k="summary" rows="4">${esc(p.summary)}</textarea></label></div>
  <div class="card stack"><h3>Work experience</h3>${renderRepeat("experience", [["company", "Company"], ["title", "Title"], ["start", "Start"], ["end", "End"]])}</div>
  <div class="card stack"><h3>Projects</h3>${renderRepeat("projects", [["name", "Name"], ["link", "Link"]])}</div>
  <div class="card stack"><h3>Education history</h3>${renderRepeat("education", [["degree", "Degree"], ["school", "College"], ["year", "Year"], ["score", "CGPA / %"]])}</div>
  <div class="small muted" style="text-align:center">Saved automatically · stored only in this browser</div>`;
}

// ----- settings -----
function renderSettings() {
  const s = S.settings, pr = s.prefs;
  const links = AM.searchLinks(pr, S.profile);
  const sv = (k, label, ph = "") => `<label class="f">${label}<input data-bind="prefField" data-k="${k}" value="${esc(pr[k] || "")}" placeholder="${esc(ph)}"></label>`;
  return `<div class="card stack"><h3>Job preferences</h3>
    ${sv("roles", "Target roles (comma separated)", "Frontend Developer, React Developer")}
    ${sv("locations", "Locations", "Bengaluru, Pune, Remote")}
    <div class="grid2">${sv("mustHave", "Must-have keywords", "React")}${sv("avoid", "Avoid keywords", "PHP, night shift")}</div>
    <div class="grid2">${sv("minCTC", "Minimum CTC (LPA)", "12")}<label class="f">Remote OK<select data-bind="prefField" data-k="remoteOk" data-type="bool">${opt("true", String(pr.remoteOk), "Yes")}${opt("false", String(pr.remoteOk), "No")}</select></label></div>
  </div>
  <div class="card stack"><h3>Saved searches</h3>
    <div class="small muted">Opens portals filtered to fresh jobs. ApplyMate never crawls them: you browse.</div>
    <button class="pri" data-act="openSearches">Open LinkedIn + Naukri (last 24h)</button>
    <details><summary class="small">All search links (${links.length})</summary><div class="list small" style="margin-top:6px">${links.map((l) => `<a target="_blank" href="${esc(l.url)}">${esc(l.site)}: ${esc(l.role)} · ${esc(l.loc)} ↗</a>`).join("")}</div></details>
  </div>
  <div class="card stack"><h3>Exact PDF with Microsoft Word</h3>
    <div class="small muted">When ApplyMate updates your Word resume, Microsoft Word on this PC makes the PDF, so it looks exactly like your Word file. Needs a one-time helper install (Windows, Word and Python).</div>
    <div class="small">Status: <b>${S.wordHelper === "ok" ? '<span style="color:var(--ok)">connected ✓</span>' : S.wordHelper === "missing" ? '<span style="color:var(--warn)">not set up</span>' : S.wordHelper ? esc(S.wordHelper) : "not checked"}</b> <button class="sm" data-act="checkHelper">Check</button></div>
    ${S.wordHelper !== "ok" ? `<ol class="small" style="margin:0;padding-left:18px"><li>Open the <b>native</b> folder inside your ApplyMate folder, double-click <b>install.bat</b>.</li><li>Paste this extension ID: <span class="kbd">${esc(chrome.runtime.id)}</span> <a href="#" data-act="copyExtId">copy</a></li><li>Press <b>Check</b>.</li></ol>` : ""}
  </div>
  <div class="card stack"><h3>AI help (free, no API key)</h3>
    <div class="small muted">“✨ Copy AI prompt” copies a ready prompt (your profile + the job + strict “no made-up facts” rules) and opens your AI chat. Paste it there, then paste the reply back into ApplyMate. Used for resume tailoring, cover letters, screening answers, interview questions and referral messages.</div>
    <div class="grid2"><label class="f">Your AI chat<select data-bind="setField" data-k="aiSite">${Object.entries(AI.SITES).map(([k, v]) => opt(k, s.aiSite, v.label)).join("")}</select></label>
    <label class="f">After copying<select data-bind="setField" data-k="aiOpenSite" data-type="bool">${opt("true", String(s.aiOpenSite !== false), "Open it in a new tab")}${opt("false", String(s.aiOpenSite !== false), "Just copy")}</select></label></div>
    <div class="small muted">On-device AI (Chrome's Gemini Nano): <b>${{ available: "available ✓, used for quick answers & key requirements", downloadable: "supported, not downloaded (needs ~22 GB disk)", downloading: "downloading…", unavailable: "not supported on this computer", unsupported: "not available in this Chrome" }[S.nano] || esc(S.nano)}</b></div>
  </div>
  <div class="card stack"><h3>Reminders & behaviour</h3>
    <div class="grid2"><label class="f">Follow up after (days)<input type="number" min="1" data-bind="setField" data-k="followUpDays" data-type="num" value="${s.followUpDays}"></label>
    <label class="f">Naukri refresh reminder (days, 0 = off)<input type="number" min="0" data-bind="setField" data-k="naukriRefreshDays" data-type="num" value="${s.naukriRefreshDays}"></label>
    <label class="f">Daily search reminder<select data-bind="setField" data-k="searchReminder" data-type="bool">${opt("true", String(s.searchReminder), "On")}${opt("false", String(s.searchReminder), "Off")}</select></label>
    <label class="f">…after hour (0-23)<input type="number" min="0" max="23" data-bind="setField" data-k="searchReminderHour" data-type="num" value="${s.searchReminderHour}"></label>
    <label class="f">Floating “Fill” button on forms<select data-bind="setField" data-k="floatingButton" data-type="bool">${opt("true", String(s.floatingButton), "Show")}${opt("false", String(s.floatingButton), "Hide")}</select></label>
    <label class="f">Auto-log one-click applies<select data-bind="setField" data-k="autoLogOneClick" data-type="bool">${opt("true", String(s.autoLogOneClick), "On")}${opt("false", String(s.autoLogOneClick), "Off")}</select></label></div>
    <div class="small muted">Shortcuts: <span class="kbd">Alt+Shift+F</span> fill form · <span class="kbd">Alt+Shift+A</span> open panel. Right-click a field → “ApplyMate: this field is…” to teach it a site.</div>
  </div>
  <div class="card stack"><h3>Your data</h3>
    <div class="small muted">Everything lives in this browser. Uninstalling the extension deletes it, so export a backup now and then.</div>
    <div class="row"><button data-act="exportJson">Export backup</button><label class="btn">Import backup<input type="file" accept="application/json" id="importJson" hidden></label><button class="danger" data-act="wipe">Delete everything</button></div>
  </div>`;
}

// ---------- actions ----------
const ACT = {
  goTab: (t) => { S.tab = t.dataset.tab; render(); },
  reread: () => loadJob(),
  checkHelper: async () => {
    S.wordHelper = await new Promise((resolve) => {
      let port;
      try { port = chrome.runtime.connectNative("com.applymate.word"); } catch { return resolve("missing"); }
      const t = setTimeout(() => { try { port.disconnect(); } catch {} resolve("no answer"); }, 8000);
      port.onMessage.addListener((m) => { clearTimeout(t); port.disconnect(); resolve(m && m.ok ? "ok" : "error"); });
      port.onDisconnect.addListener(() => { clearTimeout(t); const e = chrome.runtime.lastError && chrome.runtime.lastError.message; resolve(/not found|forbidden|specified native/i.test(e || "") ? "missing" : e || "missing"); });
      port.postMessage({ action: "ping" });
    });
    render();
  },
  copyExtId: async () => { await navigator.clipboard.writeText(chrome.runtime.id); flash("Extension ID copied"); },
  addSkill: async (t) => {
    const skill = t.dataset.skill;
    const list = AM.splitList(S.profile.skills);
    if (!list.some((s) => AM.canonSkill(s) === AM.canonSkill(skill) || s.toLowerCase() === skill.toLowerCase())) list.push(skill);
    S.profile.skills = list.join(", ");
    await AM.set("profile", S.profile);
    if (S.tailor && Array.isArray(S.tailor.skills) && !S.tailor.skills.includes(skill)) S.tailor.skills.push(skill);
    // queue it for YOUR resume file
    if (!S.queue.some((q) => q.skill.toLowerCase() === skill.toLowerCase())) S.queue.push({ skill, line: null });
    await AM.set("resumeQueue", S.queue);
    render();
    flash(S.docx ? `“${skill}” queued for your resume. Review where it goes in “Update my resume”, then preview the PDF.` : `“${skill}” added. Upload your Word resume (.docx) in Profile so ApplyMate can add it to your real resume.`);
  },
  queueRemove: async (t) => { S.queue.splice(+t.dataset.i, 1); await AM.set("resumeQueue", S.queue); render(); },
  queueAdd: async () => {
    const v = ($("#queueNew") || {}).value?.trim();
    if (!v) return;
    S.queue.push({ skill: v, line: null });
    await AM.set("resumeQueue", S.queue);
    render();
  },
  previewResume: async () => {
    if (!S.docx || !S.docx.lines.length) return flash("Upload your Word resume first.", true);
    const additions = [];
    for (const q of S.queue) {
      const idx = q.line !== null && q.line !== undefined && q.line !== "" ? +q.line : (AM.placeSkill(q.skill, S.docx.lines) || {}).index;
      if (idx === undefined || idx === null || isNaN(idx)) return flash(`Choose a line for “${q.skill}” first.`, true);
      additions.push({ skill: q.skill, lineIndex: idx });
    }
    const rec = await AM.get("file:" + S.docx.id);
    const { buffer, changes } = await addSkills(await b64ToBlob(rec.data, rec.type).arrayBuffer(), additions);
    // one draft slot: replace the previous preview draft
    const old = await chrome.storage.session.get("resumePreview");
    if (old.resumePreview) await chrome.storage.local.remove("file:" + old.resumePreview.docxFileId);
    const draftId = "draft_" + AM.uid();
    await AM.set("file:" + draftId, { name: rec.name, type: rec.type, data: await blobToB64(new Blob([buffer])) });
    const text = (await inspectDocx(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))).text;
    await chrome.storage.session.set({ resumePreview: { docxFileId: draftId, baseName: rec.name.replace(/\.docx$/i, "").replace(/\s*\(updated\)$/i, ""), changes, text } });
    await chrome.tabs.create({ url: chrome.runtime.getURL("preview/preview.html") });
  },
  reloadTab: async () => { await chrome.tabs.reload(S.tabInfo.id); setTimeout(loadJob, 1800); },
  openSearches: async () => {
    const links = AM.searchLinks(S.settings.prefs, S.profile).filter((l) => /LinkedIn|Naukri/.test(l.site)).slice(0, 8);
    if (!S.settings.prefs.roles) flash("Tip: set your target roles in Settings. Using “software engineer” for now.");
    for (const l of links) await chrome.tabs.create({ url: l.url, active: false });
  },
  fill: async () => {
    const run = (allFrames) => chrome.scripting.executeScript({ target: { tabId: S.tabInfo.id, allFrames }, func: (o) => (window.__AM_fill ? window.__AM_fill(o) : null), args: [fillOptions()] });
    let res;
    try { res = await run(true); } catch { res = await run(false); flash("Some embedded frames couldn't be reached; filled the main page."); }
    const sum = { filled: 0, review: 0, missing: [], suggested: 0, unanswered: [] };
    for (const r of res) if (r.result) {
      sum.filled += r.result.filled; sum.review += r.result.review; sum.suggested += r.result.suggested || 0; sum.missing.push(...r.result.missing);
      for (const u of r.result.unanswered || []) sum.unanswered.push({ ...u, frameId: r.frameId ?? 0 });
    }
    S.lastFill = sum;
    if (!sum.filled && !sum.missing.length) flash("No fillable fields found on this page.", true);
    render();
  },
  saveJob: async () => { await AM.upsertApp(appPayload("Saved")); await loadData(); render(); flash("Saved to tracker"); },
  markApplied: async () => { await AM.upsertApp(appPayload("Applied")); await loadData(); render(); flash(`Marked applied · follow-up in ${S.settings.followUpDays} days`); },
  saveAnswers: async () => {
    const res = await chrome.scripting.executeScript({ target: { tabId: S.tabInfo.id, allFrames: true }, func: () => (window.__AM_saveAnswers ? window.__AM_saveAnswers() : 0) });
    const n = res.reduce((s, r) => s + (r.result || 0), 0);
    flash(n ? `Saved ${n} answer${n > 1 ? "s" : ""}` : "No new typed answers on this page yet");
  },
  kwTailor: () => {
    const p = S.profile;
    const sc = AM.scoreJob(p, S.job, S.settings.prefs);
    const jd = (S.job.description || "").toLowerCase();
    const hits = (b) => AM.findSkills(b).filter((s) => sc.matched.includes(s) || sc.missing.includes(s)).length;
    const skills = AM.splitList(p.skills).sort((a, b) => (sc.matched.includes(AM.canonSkill(b)) ? 1 : 0) - (sc.matched.includes(AM.canonSkill(a)) ? 1 : 0) || (jd.includes(b.toLowerCase()) ? 1 : 0) - (jd.includes(a.toLowerCase()) ? 1 : 0));
    S.tailor = {
      summary: p.summary,
      skills,
      experience: (p.experience || []).map((e) => [...(e.bullets || [])].sort((a, b) => hits(b) - hits(a))),
      projects: (p.projects || []).map((e) => [...(e.bullets || [])].sort((a, b) => hits(b) - hits(a))),
      notes: [sc.missing.length ? `Job skills you haven't listed: ${sc.missing.map(AM.skillLabel).join(", ")}. Use "+ Add" in Match only for ones you've really used.` : ""].filter(Boolean),
      sel: {},
    };
    render();
  },
  useTailored: async () => {
    const d = tailoredData();
    const b64 = pdfBase64(resumePdf(d));
    const name = `${safeName(S.profile.firstName)}_${safeName(S.profile.lastName)}_${safeName(S.job.company)}_${safeName(S.job.title)}.pdf`;
    const id = await saveFile(name, "application/pdf", b64, "tailored", { jobKey: AM.jobKey(S.job.url) });
    await saveJobState({ resumeFileId: id });
    render();
    flash("Tailored resume saved and will be attached for this job");
  },
  dlTailored: async (t) => {
    const d = tailoredData();
    const base = `${safeName(S.profile.firstName)}_${safeName(S.job.company)}_${safeName(S.job.title)}`;
    if (t.dataset.fmt === "pdf") download(resumePdf(d).output("blob"), base + ".pdf");
    else download(await resumeDocx(d), base + ".docx");
  },
  genCoverTpl: async () => { const tone = $("#coverTone").value; await saveJobState({ coverLetter: templateCover(tone), coverTone: tone, useCover: true }); await makeCoverFile(); render(); },
  copyCover: async () => { await navigator.clipboard.writeText(S.jobState.coverLetter || ""); flash("Copied"); },
  dlCover: () => download(letterPdf(S.jobState.coverLetter, S.profile).output("blob"), `Cover_Letter_${safeName(S.job.company)}.pdf`),
  qaDraft: async () => {
    S.qa.q = $("#qaQ").value.trim();
    if (!S.qa.q) return;
    const hit = AM.findAnswer(S.answers, S.qa.q, 0.5);
    S.qa.a = hit ? AM.fillTemplate(hit.answer.a, { company: S.job.company, role: S.job.title }) : "";
    if (!S.qa.a) flash("No similar answer saved yet. Use “✨ Copy AI prompt” to draft one.", true);
    render();
  },
  qaNano: async () => {
    S.qa.q = $("#qaQ").value.trim();
    if (!S.qa.q) return;
    if (!AI.nanoCanAnswer(S.qa.q)) return flash("On-device AI is for short factual questions. Use “✨ Copy AI prompt” for this one.", true);
    S.qa.a = await AI.nanoAnswer(S.profile, S.qa.q);
    render();
  },
  nanoKeywords: async () => { S.keywords = await AI.nanoKeywords(S.job.description); await saveJobState({ keywords: S.keywords }); render(); },
  // ----- AI: copy prompt → user pastes reply → parse -----
  aiCopy: async (t) => {
    const task = t.dataset.task;
    const extra = {};
    let job = S.job, jobKey = S.job ? AM.jobKey(S.job.url) : "";
    if (task === "cover") extra.tone = ($("#coverTone") || {}).value || "concise";
    if (task === "answer") {
      extra.question = ($("#qaQ") || {}).value?.trim();
      if (!extra.question) return flash("Paste the question first.", true);
      S.qa.q = extra.question;
    }
    if (task === "questions") {
      const list = (S.lastFill && S.lastFill.unanswered) || [];
      if (!list.length) return flash("Press Fill form first: then the questions it couldn't answer are listed here.", true);
      extra.questions = list.map((u) => ({ question: u.question, kind: u.kind, options: u.options, required: u.required }));
      extra.targets = list.map((u) => ({ frameId: u.frameId, sig: u.sig }));
    }
    if (task === "interview") { const a = S.apps.find((x) => x.id === t.dataset.app); extra.appId = a.id; job = jobFromApp(a); jobKey = a.jobKey || ""; }
    if (task === "outreach") {
      const c = S.contacts.find((x) => x.id === t.dataset.contact);
      extra.contactId = c.id;
      extra.kind = (S.draft[c.id] || {}).kind || "referral";
      job = jobForContact(c);
      jobKey = job.url ? AM.jobKey(job.url) : "";
    }
    const ctx = { profile: S.profile, job, ...extra, contact: task === "outreach" ? S.contacts.find((x) => x.id === extra.contactId) : undefined };
    const { copied } = await AI.copyPrompt(task, ctx, S.settings);
    S.pending = { task, label: AI.TASKS[task], copied, jobKey, tabId: S.tabInfo ? S.tabInfo.id : null, job: { title: job.title, company: job.company, url: job.url, description: job.description }, extra };
    await chrome.storage.session.set({ aiPending: S.pending });
    render();
    flash(copied ? "Prompt copied. Paste it into your AI chat." : "Couldn't copy automatically. Copy the prompt from the box above.", !copied);
  },
  aiRecopy: async () => {
    const p = S.pending;
    const ok = await AI.copyText(pendingPrompt());
    p.copied = ok;
    render();
    flash(ok ? "Prompt copied again" : "Couldn't copy. Select the prompt in the box and press Ctrl+C.", !ok);
  },
  aiOpenSite: () => chrome.tabs.create({ url: (AI.SITES[S.settings.aiSite] || AI.SITES.claude).url }),
  aiCancel: async () => { S.pending = null; await chrome.storage.session.remove("aiPending"); render(); },
  aiApply: async () => {
    const p = S.pending;
    const text = $("#aiReply").value;
    if (!text.trim()) return flash("Paste the AI reply first.", true);
    const r = AI.parse(p.task, text, { profile: S.profile });
    if (p.task === "questions") {
      // send each answer back to the frame + field it belongs to; the page fills it and saves it to the answer bank
      const byFrame = {};
      for (const [n, ans] of Object.entries(r.answers)) {
        const t = p.extra.targets[+n - 1];
        if (!t) continue;
        (byFrame[t.frameId] = byFrame[t.frameId] || {})[t.sig] = ans;
      }
      if (p.tabId) { try { await chrome.tabs.update(p.tabId, { active: true }); } catch {} }
      let filled = 0, suggested = 0;
      for (const [fid, map] of Object.entries(byFrame)) {
        try {
          const res = await chrome.scripting.executeScript({ target: { tabId: p.tabId, frameIds: [+fid] }, func: (m) => (window.__AM_applyAnswers ? window.__AM_applyAnswers(m) : null), args: [map] });
          for (const x of res) if (x.result) { filled += x.result.filled; suggested += x.result.suggested; }
        } catch {}
      }
      S.pending = null;
      await chrome.storage.session.remove("aiPending");
      S.tab = "job";
      await loadJob();
      if (S.lastFill) S.lastFill.unanswered = [];
      render();
      const skipped = p.extra.questions.length - Object.keys(r.answers).length;
      return flash(`Filled ${filled} answer${filled === 1 ? "" : "s"} (amber: check them)${suggested ? `, ${suggested} chat answer suggested` : ""}${skipped > 0 ? `. ${skipped} skipped: your profile doesn't say` : ""}. Saved to your answer bank.`);
    }
    const jsKey = "jobState:" + p.jobKey;
    const js = p.jobKey ? await AM.get(jsKey, {}) : {};
    if (p.task === "tailor") { js.tailor = r; S.tab = "job"; }
    if (p.task === "cover") { Object.assign(js, { coverLetter: r.text, coverTone: p.extra.tone, useCover: true, needCoverFile: true }); S.tab = "job"; }
    if (p.task === "answer") { js.qa = { q: p.extra.question, a: r.text }; S.tab = "job"; }
    if (p.jobKey && ["tailor", "cover", "answer"].includes(p.task)) await AM.set(jsKey, js);
    if (p.task === "interview") { S.tab = "tracker"; S.detailId = p.extra.appId; S.iq = { id: p.extra.appId, questions: r.questions }; }
    if (p.task === "outreach") { S.tab = "contacts"; S.contactOpen = p.extra.contactId; S.draft[p.extra.contactId] = { kind: p.extra.kind, text: r.text }; }
    S.pending = null;
    await chrome.storage.session.remove("aiPending");
    // go back to the job's tab so the result shows next to the job
    if (["tailor", "cover", "answer"].includes(p.task)) {
      if (!p.jobKey) return flash("Open the job page again to see the result.", true);
      if (p.tabId) { try { await chrome.tabs.update(p.tabId, { active: true }); } catch {} }
      await loadJob();
      if (p.task === "tailor" && S.job && AM.jobKey(S.job.url) === p.jobKey) S.tailor = { ...r, sel: {} };
      render();
    } else render();
    flash("AI reply applied. Check it before using it.");
  },
  qaCopy: async () => { await navigator.clipboard.writeText($("#qaA").value); flash("Copied: paste it into the form"); },
  qaSave: async () => {
    S.answers.unshift({ id: AM.uid(), q: S.qa.q, a: $("#qaA").value, updatedAt: AM.today(), uses: 0 });
    await AM.set("answers", S.answers);
    flash("Saved to answer bank");
  },
  saveLiContact: async () => {
    const c = { id: AM.uid(), ...S.li, company: $("#liCompany").value, relationship: $("#liRel").value, status: "Not contacted", channel: "LinkedIn", createdAt: AM.today() };
    if (S.contacts.find((x) => x.url === c.url)) return flash("Already saved");
    S.contacts.unshift(c);
    await saveContacts();
    flash("Contact saved");
  },
  saveJobContact: async (t) => {
    const pc = S.job.contacts[+t.dataset.i];
    S.contacts.unshift({ id: AM.uid(), name: pc.name || pc.email, email: pc.email || "", url: pc.url || "", company: S.job.company, headline: "From job posting", relationship: "Recruiter", status: "Not contacted", channel: pc.email ? "Email" : "LinkedIn", createdAt: AM.today(), appId: (currentApp() || {}).id || "" });
    await saveContacts();
    flash("Contact saved");
  },
  openContact: (t) => { S.tab = "contacts"; S.contactOpen = t.dataset.id; render(); },
  closeContact: () => { S.contactOpen = null; render(); },
  toggleAddContact: () => { S.addContactOpen = !S.addContactOpen; render(); },
  addContact: async () => {
    const name = $("#cName").value.trim();
    if (!name) return flash("Name is required", true);
    const em = $("#cEmail").value.trim();
    S.contacts.unshift({ id: AM.uid(), name, company: $("#cCompany").value.trim(), headline: $("#cHeadline").value.trim(), relationship: $("#cRel").value, url: $("#cUrl").value.trim(), email: em, status: "Not contacted", channel: em.includes("@") ? "Email" : "LinkedIn", createdAt: AM.today() });
    S.addContactOpen = false;
    await saveContacts();
    render();
  },
  delContact: async (t) => { if (!confirm("Delete this contact?")) return; S.contacts = S.contacts.filter((c) => c.id !== t.dataset.id); await saveContacts(); render(); },
  draftTpl: (t) => {
    const c = S.contacts.find((x) => x.id === t.dataset.id);
    const d = (S.draft[c.id] = S.draft[c.id] || { kind: "referral" });
    d.text = AM.fillTemplate(AM.OUTREACH[d.kind], contactVars(c, jobForContact(c))).replace(/\s*\(\{url\}\)/, "");
    render();
  },
  copyDraft: async (t) => { await navigator.clipboard.writeText(S.draft[t.dataset.id].text); flash("Copied: paste it into LinkedIn / email"); },
  markSent: async (t) => {
    const c = S.contacts.find((x) => x.id === t.dataset.id);
    Object.assign(c, { status: "Request sent", contactedOn: AM.today(), followUp: AM.addDays(AM.today(), 5) });
    await saveContacts();
    render();
    flash("Marked as sent. Follow-up reminder set for 5 days.");
  },
  openApp: (t) => { S.detailId = t.dataset.id; S.iq = null; render(); },
  openAppFromContacts: (t) => { S.tab = "tracker"; S.detailId = t.dataset.id; render(); },
  closeApp: () => { S.detailId = null; render(); },
  trackerView: (t) => { S.trackerView = t.dataset.v; render(); },
  toggleInbound: () => { S.inboundOpen = !S.inboundOpen; render(); },
  saveInbound: async () => {
    const company = $("#inCompany").value.trim(), name = $("#inName").value.trim(), ct = $("#inContact").value.trim();
    if (!company) return flash("Company is required", true);
    const app = await AM.upsertApp({ company, role: $("#inRole").value.trim() || "(role TBD)", status: "Screening", source: "Inbound", contactPerson: [name, ct].filter(Boolean).join(" · "), salary: $("#inCtc").value.trim(), notes: $("#inNext").value.trim(), statusNote: `Recruiter reached out via ${$("#inChannel").value}`, followUp: AM.addDays(AM.today(), 3) });
    if (name) {
      S.contacts.unshift({ id: AM.uid(), name, company, email: ct, headline: "Recruiter", relationship: "Recruiter", status: "Replied", channel: $("#inChannel").value, createdAt: AM.today(), appId: app.id });
      await saveContacts();
    }
    S.inboundOpen = false;
    await loadData();
    render();
    flash("Added to tracker");
  },
  exportCsv: () => {
    const cols = ["company", "role", "status", "appliedOn", "followUp", "source", "portal", "location", "contactPerson", "salary", "url", "notes"];
    const csv = [cols.join(","), ...S.apps.map((a) => cols.map((c) => `"${String(a[c] ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`).join(","))].join("\n");
    download(new Blob([csv], { type: "text/csv" }), `applymate_applications_${AM.today()}.csv`);
  },
  addRound: async () => {
    const a = S.apps.find((x) => x.id === S.detailId);
    const name = $("#rName").value.trim();
    if (!name) return flash("Give the round a name", true);
    a.rounds = a.rounds || [];
    a.rounds.push({ id: AM.uid(), name, at: $("#rAt").value, notes: $("#rNotes").value.trim() });
    a.rounds.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    if (["Saved", "Applied", "Screening"].includes(a.status)) await AM.upsertApp({ id: a.id, status: "Interview", rounds: a.rounds, statusNote: name });
    else await saveApps();
    await loadData();
    render();
  },
  delRound: async (t) => { const a = S.apps.find((x) => x.id === S.detailId); a.rounds = a.rounds.filter((r) => r.id !== t.dataset.id); await saveApps(); render(); },
  iqToPrep: async () => {
    const a = S.apps.find((x) => x.id === S.detailId);
    a.prep = (a.prep ? a.prep + "\n\n" : "") + S.iq.questions.map((q, i) => `${i + 1}. ${q.q}\n   Tip: ${q.tip}`).join("\n");
    await saveApps();
    S.iq = null;
    render();
  },
  delApp: async () => { if (!confirm("Delete this application?")) return; S.apps = S.apps.filter((a) => a.id !== S.detailId); S.detailId = null; await saveApps(); render(); },
  addAnswer: async () => { S.answers.unshift({ id: AM.uid(), q: "New question", a: "", updatedAt: AM.today(), uses: 0 }); await AM.set("answers", S.answers); render(); },
  delAnswer: async (t) => { S.answers = S.answers.filter((a) => a.id !== t.dataset.id); await AM.set("answers", S.answers); render(); },
  repAdd: (t) => { const k = t.dataset.kind; S.profile[k] = [...(S.profile[k] || []), {}]; saveProfile(); render(); },
  repDel: (t) => { const k = t.dataset.kind; S.profile[k].splice(+t.dataset.i, 1); saveProfile(); render(); },
  dlFile: async (t) => { const rec = await AM.get("file:" + t.dataset.id); if (rec) download(b64ToBlob(rec.data, rec.type), rec.name); },
  delFile: async (t) => {
    if (!confirm("Delete this file?")) return;
    await chrome.storage.local.remove("file:" + t.dataset.id);
    S.files = S.files.filter((f) => f.id !== t.dataset.id);
    await AM.set("files", S.files);
    if (S.profile.defaultResumeId === t.dataset.id) { S.profile.defaultResumeId = (S.files.find((f) => f.kind === "resume") || {}).id || ""; await AM.set("profile", S.profile); }
    render();
  },
  exportJson: async () => {
    const all = await chrome.storage.local.get(null);
    download(new Blob([JSON.stringify(all)], { type: "application/json" }), `applymate_backup_${AM.today()}.json`);
  },
  wipe: async () => {
    if (!confirm("Delete ALL ApplyMate data (profile, resumes, tracker, contacts, answers)? This can't be undone.")) return;
    await chrome.storage.local.clear();
    await AM.set("settings", AM.DEFAULT_SETTINGS);
    await loadData();
    render();
  },
};

function appPayload(status) {
  const f = S.files.find((x) => x.id === (S.jobState.resumeFileId || S.profile.defaultResumeId));
  const sc = AM.scoreJob(S.profile, S.job, S.settings.prefs);
  return { url: S.job.url, company: S.job.company, role: S.job.title, location: S.job.location, jd: (S.job.description || "").slice(0, 8000), status, resumeName: f ? f.name : "", coverLetter: S.jobState.useCover ? S.jobState.coverLetter : "", score: sc.score, source: AM.portal(S.job.url).match(/linkedin|naukri|indeed|wellfound|instahyre/) ? "Portal" : "Company site" };
}
function tailoredData() {
  const t = S.tailor, sel = (id) => t.sel[id] !== false;
  const ov = { experience: [], projects: [] };
  if (sel("summary")) ov.summary = t.summary;
  if (sel("skills")) ov.skills = t.skills;
  t.experience.forEach((b, i) => { if (b && sel("exp:" + i)) ov.experience[i] = b; });
  t.projects.forEach((b, i) => { if (b && sel("proj:" + i)) ov.projects[i] = b; });
  return resumeData(S.profile, ov);
}
function templateCover(tone) {
  const p = S.profile, j = S.job;
  const sc = AM.scoreJob(p, j, S.settings.prefs);
  const skills = (sc.matched.length ? pretty(sc.matched) : AM.splitList(p.skills)).slice(0, 4).join(", ");
  const bullet = ((p.experience || [])[0] || {}).bullets ? p.experience[0].bullets[0] : "";
  const open = { formal: `Dear Hiring Team at ${j.company},\n\nI am writing to apply for the ${j.title} position.`, concise: `Hi ${j.company} team,\n\nI'd like to apply for the ${j.title} role.`, enthusiastic: `Hello ${j.company} team,\n\nI was really excited to see the ${j.title} opening!` }[tone];
  return `${open} I have ${p.totalExperience || "several"} years of experience${p.currentTitle ? " as a " + p.currentTitle : ""}${p.currentCompany ? " at " + p.currentCompany : ""}, working mainly with ${skills || "modern web technologies"}.${bullet ? `\n\nRecently, ${bullet.charAt(0).toLowerCase() + bullet.slice(1).replace(/\.$/, "")}.` : ""}\n\nI'd love to bring this experience to ${j.company} and contribute from day one. My notice period is ${p.noticePeriod || "flexible"} days.\n\nThank you for your time,\n${AM.profileValue(p, "fullName")}`;
}
async function makeCoverFile() {
  if (!S.jobState.coverLetter) return;
  const b64 = pdfBase64(letterPdf(S.jobState.coverLetter, S.profile));
  if (S.jobState.coverFileId) { await chrome.storage.local.remove("file:" + S.jobState.coverFileId); S.files = S.files.filter((f) => f.id !== S.jobState.coverFileId); }
  const id = await saveFile(`Cover_Letter_${safeName(S.profile.firstName)}_${safeName(S.job.company)}.pdf`, "application/pdf", b64, "cover", { jobKey: AM.jobKey(S.job.url) });
  await saveJobState({ coverFileId: id });
}

// ---------- bindings (inputs) ----------
const BIND = {
  jobField: async (t) => { S.job[t.dataset.k] = t.value; await saveJobState({ [t.dataset.k]: t.value }); },
  appStatus: async (t) => { const a = currentApp(); await AM.upsertApp({ id: a.id, status: t.value }); await loadData(); render(); },
  jobResume: async (t) => { await saveJobState({ resumeFileId: t.value }); },
  coverText: async (t) => { await saveJobState({ coverLetter: t.value }); },
  coverTextBlur: async () => { if (S.jobState.useCover) await makeCoverFile(); },
  useCover: async (t) => { await saveJobState({ useCover: t.checked }); if (t.checked) await makeCoverFile(); },
  trackerQ: (t) => { S.trackerQ = t.value; renderKeepFocus(t); },
  trackerStatus: (t) => { S.trackerStatus = t.value; render(); },
  appStatusDetail: async (t) => { await AM.upsertApp({ id: S.detailId, status: t.value }); await loadData(); render(); },
  appField: async (t) => { const a = S.apps.find((x) => x.id === S.detailId); a[t.dataset.k] = t.value; a.updatedAt = new Date().toISOString(); await saveApps(); },
  contactQ: (t) => { S.contactQ = t.value; renderKeepFocus(t); },
  contactField: async (t) => { const c = S.contacts.find((x) => x.id === t.dataset.id); c[t.dataset.k] = t.value; await saveContacts(); },
  draftKind: (t) => { S.draft[t.dataset.id] = { kind: t.value, text: "" }; render(); },
  draftText: (t) => { S.draft[t.dataset.id].text = t.value; },
  answerQ: (t) => { S.answerQ = t.value; renderKeepFocus(t); },
  ansField: async (t) => { const a = S.answers.find((x) => x.id === t.dataset.id); a[t.dataset.k] = t.value; a.updatedAt = AM.today(); await AM.set("answers", S.answers); },
  profileField: (t) => { S.profile[t.dataset.k] = t.dataset.type === "bool" ? t.value === "true" : t.value; saveProfile(); },
  rep: (t) => { const it = S.profile[t.dataset.kind][+t.dataset.i]; it[t.dataset.k] = t.dataset.k === "bullets" ? t.value.split("\n").map((s) => s.trim()).filter(Boolean) : t.value; saveProfile(); },
  queueLine: async (t) => { S.queue[+t.dataset.i].line = t.value === "" ? null : +t.value; await AM.set("resumeQueue", S.queue); render(); },
  defaultResume: async (t) => { S.profile.defaultResumeId = t.value; await AM.set("profile", S.profile); if (S.job) await syncFillOptions(); },
  prefField: async (t) => { S.settings.prefs[t.dataset.k] = t.dataset.type === "bool" ? t.value === "true" : t.value; await AM.saveSettings({ prefs: S.settings.prefs }); },
  setField: async (t) => {
    const v = t.dataset.type === "bool" ? t.value === "true" : t.dataset.type === "num" ? +t.value : t.value.trim();
    S.settings[t.dataset.k] = v;
    await AM.saveSettings({ [t.dataset.k]: v });
    if (t.dataset.k === "aiSite" || t.dataset.k === "aiOpenSite") render();
  },
};
function renderKeepFocus(t) {
  const sel = `[data-bind="${t.dataset.bind}"]`;
  const pos = t.selectionStart;
  render();
  const n = $(sel);
  if (n) { n.focus(); n.setSelectionRange(pos, pos); }
}
const liveBinds = new Set(["trackerQ", "contactQ", "answerQ", "draftText", "profileField", "rep", "coverText", "appField", "ansField", "contactField", "jobField"]);

document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches("[data-selectall]")) e.target.select(); });
document.addEventListener("click", async (e) => {
  const tabBtn = e.target.closest(".tabs button");
  if (tabBtn) { S.tab = tabBtn.dataset.tab; if (S.tab !== "tracker") S.detailId = null; render(); return; }
  const tsel = e.target.closest("[data-tsel]");
  if (tsel) { S.tailor.sel[tsel.dataset.tsel] = tsel.checked; return; }
  const t = e.target.closest("[data-act]");
  if (!t || (e.target.closest("select, input, textarea") && t.contains(e.target.closest("select, input, textarea")) && t.tagName !== "BUTTON")) return;
  if (t.tagName === "A" && t.getAttribute("href") === "#") e.preventDefault();
  const fn = ACT[t.dataset.act];
  if (!fn) return;
  const isBtn = t.tagName === "BUTTON";
  const label = isBtn ? t.textContent : "";
  try {
    if (isBtn) { t.disabled = true; if (/on-device|Extract/.test(label)) t.textContent = "Working…"; }
    await fn(t);
  } catch (err) {
    console.error(err);
    flash(err.message || String(err), true);
  } finally {
    if (isBtn && t.isConnected) { t.disabled = false; t.textContent = label; }
  }
});
const onBind = async (e) => {
  const t = e.target.closest("[data-bind]");
  if (!t) return;
  const b = t.dataset.bind;
  if (e.type === "input" && !liveBinds.has(b)) return;
  if (e.type === "change" && liveBinds.has(b) && !["profileField", "rep"].includes(b) && t.tagName !== "SELECT") {
    if (b === "coverText") BIND.coverTextBlur();
    return;
  }
  try { await BIND[b](t); } catch (err) { flash(err.message, true); }
};
document.addEventListener("input", onBind);
document.addEventListener("change", onBind);

// file inputs
document.addEventListener("change", async (e) => {
  if (e.target.id === "resumeUpload" && e.target.files[0]) {
    const file = e.target.files[0];
    flash("Reading resume…");
    try {
      const buf = await file.arrayBuffer();
      const b64 = await blobToB64(file);
      const isDocx = /\.docx$/i.test(file.name);
      if (isDocx) {
        // your editable source resume
        const info = await inspectDocx(buf);
        const id = await saveFile(file.name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b64, "resume-docx");
        const p = S.profile;
        const parsed = heuristicParse(info.text);
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) { if (!(p[k] || []).length && v.length) p[k] = v; }
          else if (v && !p[k]) p[k] = v;
        }
        if (!p.resumeText) p.resumeText = info.text;
        p.sourceDocxId = id;
        await AM.set("profile", p);
        S.docx = null;
        await loadData();
        render();
        flash(info.lines.length ? `Word resume ready: found ${info.lines.length} skill line${info.lines.length > 1 ? "s" : ""} (${info.lines.map((l) => l.label).join(", ")}).` : "Word resume saved, but no Skills section was found in it.", !info.lines.length);
        return;
      }
      const id = await saveFile(file.name, file.type || "application/pdf", b64, "resume");
      const text = await pdfText(buf);
      const parsed = heuristicParse(text);
      const p = S.profile;
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) { if (!(p[k] || []).length && v.length) p[k] = v; }
        else if (v && !p[k]) p[k] = v;
      }
      p.resumeText = text;
      if (!p.defaultResumeId) p.defaultResumeId = id;
      await AM.set("profile", p);
      render();
      flash("Resume read. Check and complete the fields below, especially work experience.");
    } catch (err) {
      flash("Couldn't read that PDF: " + err.message, true);
    }
  }
  if (e.target.id === "importJson" && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data.settings && !data.profile) throw new Error("Not an ApplyMate backup");
      if (!confirm("Import this backup? It will overwrite matching data.")) return;
      await chrome.storage.local.set(data);
      await loadData();
      render();
      flash("Backup imported");
    } catch (err) {
      flash(err.message, true);
    }
  }
});

// kanban drag & drop
document.addEventListener("dragstart", (e) => { const d = e.target.closest && e.target.closest("[data-drag]"); if (d) e.dataTransfer.setData("text/plain", d.dataset.drag); });
document.addEventListener("dragover", (e) => { const c = e.target.closest && e.target.closest("[data-drop]"); if (c) { e.preventDefault(); c.classList.add("drop"); } });
document.addEventListener("dragleave", (e) => { const c = e.target.closest && e.target.closest("[data-drop]"); if (c) c.classList.remove("drop"); });
document.addEventListener("drop", async (e) => {
  const c = e.target.closest && e.target.closest("[data-drop]");
  if (!c) return;
  e.preventDefault();
  const id = e.dataTransfer.getData("text/plain");
  await AM.upsertApp({ id, status: c.dataset.drop });
  await loadData();
  render();
});

// ---------- live updates ----------
const refresh = debounce(async () => {
  await loadData();
  const a = document.activeElement;
  if (a && view.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return; // don't yank focus while typing
  render();
}, 250);
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local") refresh(); });
chrome.tabs.onActivated.addListener(() => loadJob());
// Single-page portals (LinkedIn job search) switch jobs via history API: react to URL changes too.
const reloadJobSoon = debounce(loadJob, 800);
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.status === "complete" || info.url)) reloadJobSoon(); });

(async function init() {
  await loadData();
  S.pending = (await chrome.storage.session.get("aiPending")).aiPending || null; // survives closing the panel
  S.nano = await AI.nanoStatus();
  render();
  await loadJob();
})();
