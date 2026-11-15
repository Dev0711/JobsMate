/* ApplyMate AI layer. No API keys, no cost.
   Providers:
   - "copy" (default): builds a prompt, copies it, opens your AI chat (Claude / ChatGPT / Gemini).
     You paste the reply back into the side panel; parse() reads it.
   - "nano": Chrome's built-in AI (Gemini Nano, Prompt API) — used automatically, only for small tasks,
     only when the browser reports it "available".
   Nothing is ever put in a URL; the prompt travels only via your clipboard. */

export const SITES = {
  claude: { label: "Claude", url: "https://claude.ai/new" },
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/" },
  gemini: { label: "Gemini", url: "https://gemini.google.com/app" },
};
export const TASKS = {
  tailor: "Tailor resume",
  cover: "Cover letter",
  answer: "Screening answer",
  interview: "Interview questions",
  outreach: "Outreach message",
};

// ---------- context ----------
export function profileBrief(p, { includePay = false } = {}) {
  const lines = [
    `Name: ${AM.profileValue(p, "fullName")}`,
    p.currentTitle && `Current role: ${p.currentTitle}${p.currentCompany ? " at " + p.currentCompany : ""}`,
    p.totalExperience && `Total experience: ${p.totalExperience} years`,
    p.city && `Location: ${p.city}`,
    p.skills && `Skills: ${p.skills}`,
    p.summary && `Current summary: ${p.summary}`,
    p.noticePeriod && `Notice period: ${p.noticePeriod} days`,
    includePay && p.currentCTC && `Current CTC: ${p.currentCTC} LPA`,
    includePay && p.expectedCTC && `Expected CTC: ${p.expectedCTC} LPA`,
  ].filter(Boolean);
  (p.experience || []).forEach((e, i) => lines.push(`\nExperience ${i + 1}: ${e.title} at ${e.company} (${e.start || ""} – ${e.end || ""})\n${(e.bullets || []).map((b) => "- " + b).join("\n")}`));
  (p.projects || []).forEach((e, i) => lines.push(`\nProject ${i + 1}: ${e.name}${e.link ? " (" + e.link + ")" : ""}\n${(e.bullets || []).map((b) => "- " + b).join("\n")}`));
  (p.education || []).forEach((e) => lines.push(`Education: ${e.degree}, ${e.school} ${e.year || ""}`));
  if (!(p.experience || []).length && p.resumeText) lines.push("\nResume text:\n" + p.resumeText.slice(0, 10000));
  return lines.join("\n");
}
const jobBrief = (j) => `Job title: ${j.title || ""}\nCompany: ${j.company || ""}\nLocation: ${j.location || "n/a"}\n\nJob description:\n${(j.description || "(not available)").slice(0, 10000)}`;

const RULES = `RULES (follow strictly):
- Use ONLY facts from MY PROFILE. Never invent employers, titles, years, numbers, metrics, skills, degrees or achievements.
- If a fact is missing, leave it out (or write [fill in] where it is essential).
- Plain text only inside each section. No markdown tables.
- Reply in EXACTLY the format below, keeping the === markers on their own lines. Nothing before the first marker.`;

// ---------- prompts ----------
export function buildPrompt(task, ctx) {
  const { profile: p, job = {}, question, tone, contact, kind } = ctx;
  const head = (what) => `I'm applying for a job. ${what}\n\n<MY PROFILE>\n${profileBrief(p, { includePay: task === "answer" })}\n</MY PROFILE>\n\n<JOB>\n${jobBrief(job)}\n</JOB>\n\n${RULES}\n\nFORMAT:\n`;
  switch (task) {
    case "tailor": {
      const exp = (p.experience || []).map((e, i) => `### Experience ${i + 1}\n- bullet\n- bullet`).join("\n");
      const proj = (p.projects || []).map((e, i) => `### Project ${i + 1}\n- bullet`).join("\n");
      return head("Tailor my resume to this job: you may reorder, tighten and reword my existing bullets and emphasise skills I really have that the job wants.") +
        `===SUMMARY===\n(2-3 lines aimed at this role)\n===SKILLS===\n(my existing skills only, most relevant first, comma separated, max 18)\n===BULLETS===\n${exp || "### Experience 1\n- bullet"}\n${proj}\n(max 5 bullets per experience, 3 per project; keep the numbering from MY PROFILE)\n===NOTES===\n- (up to 4 short tips, e.g. JD keywords I could add only if genuinely true)`;
    }
    case "cover":
      return head(`Write a ${tone || "concise"} cover letter (max 220 words): why this role/company, 2-3 concrete matches between my real experience and the job's needs, one-line close, signed with my name. No placeholders like [Company].`) +
        `===COVER_LETTER===\n(the letter)`;
    case "answer":
      return head(`Answer this application form question for me:\n"${question}"\nMatch the length the question implies (a number or yes/no if that's what's asked; otherwise 2-5 sentences).`) +
        `===ANSWER===\n(the answer I can paste into the form)`;
    case "interview":
      return head("List 10 likely interview questions for this role (technical, system design if senior enough, behavioural), focused on the job's requirements and my gaps.") +
        `===QUESTIONS===\nQ: (question)\nWhy: (why it's likely)\nTip: (one-line tip based on my real experience)\n\n(repeat Q/Why/Tip for each)`;
    case "outreach": {
      const what = {
        connect: "a LinkedIn connection note, STRICTLY under 280 characters",
        referral: `a referral request (under 120 words) that includes the job link ${job.url || ""}`,
        hr: "a short note to the recruiter/HR (under 100 words)",
        followup: "a polite follow-up (under 60 words) to a message they haven't replied to",
      }[kind || "referral"];
      return head(`Write ${what} to ${contact.name}${contact.headline ? " (" + contact.headline + ")" : ""}, relationship: ${contact.relationship || "cold"}. Warm, specific, not salesy.`) +
        `===MESSAGE===\n(the message)`;
    }
  }
  throw new Error("Unknown AI task " + task);
}

// ---------- lenient reply parser ----------
const LABELS = { SUMMARY: "summary", SKILLS: "skills", BULLETS: "bullets", NOTES: "notes", "COVER LETTER": "cover", COVER_LETTER: "cover", COVERLETTER: "cover", ANSWER: "answer", QUESTIONS: "questions", MESSAGE: "message" };
const MARK = /^\s*[#>*_`\s]*(?:={2,}\s*)?(summary|skills|bullets|notes|cover[ _-]?letter|answer|questions|message)(?:\s*={2,})?[*_`\s]*:?\s*(.*)$/i;
const clean = (s) => s.replace(/\*\*|__|`/g, "").replace(/^["“]|["”]$/g, "").trim();
const BUL = /^\s*(?:[-*•●▪◦]|\d+[.)])\s+(.*)$/;

export function sections(text) {
  const out = {};
  let cur = null;
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    if (/^\s*```/.test(raw)) continue;
    const m = raw.match(MARK);
    // a marker line is short; "Summary: blah" inline is allowed, a long sentence starting with "Answer" is not a marker
    if (m && (raw.includes("===") || raw.trim().length < 40 || /^\s*[#*]/.test(raw) || /:\s*\S/.test(raw))) {
      cur = LABELS[m[1].toUpperCase().replace(/[ -]/, "_")] || LABELS[m[1].toUpperCase()] || m[1].toLowerCase();
      out[cur] = [];
      if (m[2] && m[2].trim() && !/^=+$/.test(m[2].trim())) out[cur].push(m[2]);
      continue;
    }
    if (cur) out[cur].push(raw);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join("\n").trim();
  return out;
}

function parseBullets(text, profile) {
  const exp = [], proj = [];
  let target = null;
  const exps = profile.experience || [], projs = profile.projects || [];
  for (const raw of String(text || "").split("\n")) {
    const line = clean(raw);
    if (!line) continue;
    const h = line.match(/^#*\s*(experience|exp|job|role|project|proj)\s*#?\s*(\d+)/i);
    const b = raw.match(BUL);
    if (h) { target = { arr: /^proj/i.test(h[1]) ? proj : exp, i: +h[2] - 1 }; target.arr[target.i] = target.arr[target.i] || []; continue; }
    if (!b && /^#+\s*/.test(raw)) {
      // heading by name: "### Frontend Developer @ Acme"
      const name = line.replace(/^#+\s*/, "");
      let bi = -1, bs = 0.34;
      exps.forEach((e, i) => { const s = AM.similarity(`${e.title} ${e.company}`, name); if (s > bs) { bs = s; bi = i; } });
      let pi = -1, ps = bs;
      projs.forEach((e, i) => { const s = AM.similarity(e.name, name); if (s > ps) { ps = s; pi = i; } });
      if (pi >= 0) target = { arr: proj, i: pi }; else if (bi >= 0) target = { arr: exp, i: bi }; else target = null;
      if (target) target.arr[target.i] = target.arr[target.i] || [];
      continue;
    }
    if (b) {
      if (!target && exps.length === 1) { target = { arr: exp, i: 0 }; exp[0] = exp[0] || []; }
      if (target) target.arr[target.i].push(clean(b[1]));
    } else if (target && target.arr[target.i].length && !/^\(.*\)$/.test(line)) {
      const a = target.arr[target.i];
      a[a.length - 1] += " " + line; // wrapped bullet
    }
  }
  return { experience: exp, projects: proj };
}

function stripPreamble(t) {
  const lines = String(t || "").replace(/\r/g, "").split("\n");
  while (lines.length > 1 && /^(sure|here('|’)s|here is|of course|certainly|absolutely)\b.*[:!.]\s*$/i.test(lines[0].trim())) lines.shift();
  return lines.join("\n").replace(/```[a-z]*\n?/g, "").trim();
}

/** Parse an AI chat reply for a task. Never throws on odd formatting; returns best effort. */
export function parse(task, text, ctx) {
  const sec = sections(text);
  const whole = stripPreamble(Object.keys(sec).length ? "" : text);
  switch (task) {
    case "tailor": {
      const b = parseBullets(sec.bullets || (Object.keys(sec).length ? "" : text), ctx.profile);
      const skills = AM.splitList(clean(sec.skills || "").replace(/\n/g, ","));
      const notes = (sec.notes || "").split("\n").map((l) => clean(l.replace(BUL, "$1"))).filter((l) => l && !/^\(.*\)$/.test(l));
      const r = { summary: clean(sec.summary || ""), skills, experience: b.experience, projects: b.projects, notes };
      if (!r.summary && !skills.length && !b.experience.length && !b.projects.length) throw new Error("Couldn't find the SUMMARY / SKILLS / BULLETS sections in that reply. Copy the AI's whole answer and try again.");
      return r;
    }
    case "cover":
      return { text: clean(sec.cover || "") || whole || stripPreamble(text) };
    case "answer":
      return { text: clean(sec.answer || "") || whole || stripPreamble(text) };
    case "outreach":
      return { text: clean(sec.message || "") || whole || stripPreamble(text) };
    case "interview": {
      const body = sec.questions || stripPreamble(text);
      const qs = [];
      let cur = null;
      for (const raw of body.split("\n")) {
        const line = clean(raw);
        if (!line) continue;
        let m;
        if ((m = line.match(/^(?:q(?:uestion)?\s*\d*\s*[:.)-]|\d+[.)])\s*(.+)$/i))) { cur = { q: m[1].trim(), why: "", tip: "" }; qs.push(cur); }
        else if (cur && (m = line.match(/^(?:[-*•]\s*)?why\s*(?:it'?s likely)?\s*[:-]\s*(.+)$/i))) cur.why = m[1];
        else if (cur && (m = line.match(/^(?:[-*•]\s*)?tip\s*[:-]\s*(.+)$/i))) cur.tip = m[1];
        else if (!cur || /\?\s*$/.test(line)) { cur = { q: line.replace(BUL, "$1"), why: "", tip: "" }; qs.push(cur); }
      }
      if (!qs.length) throw new Error("Couldn't find any questions in that reply.");
      return { questions: qs.slice(0, 20) };
    }
  }
  throw new Error("Unknown AI task " + task);
}

// ---------- Chrome built-in AI (Gemini Nano) ----------
export async function nanoStatus() {
  try {
    if (!("LanguageModel" in self)) return "unsupported";
    return await self.LanguageModel.availability();
  } catch {
    return "unsupported";
  }
}
async function nano(prompt, schema) {
  const s = await self.LanguageModel.create();
  try {
    const out = await s.prompt(prompt, schema ? { responseConstraint: schema } : undefined);
    return schema ? JSON.parse(out) : out.trim();
  } finally {
    s.destroy && s.destroy();
  }
}
const SHORT_Q = /how many|years|notice|ctc|salary|expected|current|are you|do you|have you|can you|will you|when can|relocat|yes\/no|authori[sz]ed|sponsor/i;
export const nanoCanAnswer = (q) => String(q || "").length < 140 && SHORT_Q.test(q);

/** Extract key requirements from a JD on-device. Only call when nanoStatus() === "available". */
export const nanoKeywords = (jd) =>
  nano(`List the 8-12 most important skills or requirements in this job description, as short phrases.\n\n${String(jd).slice(0, 6000)}`, { type: "array", items: { type: "string" } });

/** One-line factual answer on-device. */
export const nanoAnswer = (profile, question) =>
  nano(`Using ONLY these facts about me, answer the job application question in one short line. If the facts don't cover it, reply exactly: [fill in]\n\nFacts:\n${profileBrief(profile, { includePay: true }).slice(0, 3000)}\n\nQuestion: ${question}`);

// ---------- provider interface ----------
/** generate(task, ctx, settings):
 *  - on-device provider for small tasks when available → { done: true, result }
 *  - otherwise the copy-prompt provider → { done: false, prompt } (finish with parse(task, pastedReply, ctx))
 *  An API-key provider could later be added here with the same return shape. */
export async function generate(task, ctx, settings) {
  if (task === "answer" && nanoCanAnswer(ctx.question) && (await nanoStatus()) === "available") {
    return { done: true, result: { text: await nanoAnswer(ctx.profile, ctx.question) } };
  }
  if (task === "keywords") {
    if ((await nanoStatus()) !== "available") throw new Error("On-device AI isn't available in this Chrome.");
    return { done: true, result: await nanoKeywords(ctx.job.description) };
  }
  return { done: false, ...(await copyPrompt(task, ctx, settings)) };
}

// ---------- copy-prompt provider ----------
/** Copy text: async clipboard first, then the legacy copy command (works without page focus in extensions). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Copy the prompt and (optionally) open the user's AI chat in a new tab. Returns {prompt, copied}. */
export async function copyPrompt(task, ctx, settings) {
  const prompt = buildPrompt(task, ctx);
  const copied = await copyText(prompt);
  if (copied && settings.aiOpenSite !== false) {
    const site = SITES[settings.aiSite] || SITES.claude;
    await chrome.tabs.create({ url: site.url }); // no data in the URL, ever
  }
  return { prompt, copied };
}
