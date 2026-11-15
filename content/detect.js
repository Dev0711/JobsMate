/* Page reading: job info, LinkedIn profile info, form fields. Only reads the page the user has open. */
(function () {
  if (window.__AM_detect) return;
  const D = (window.__AM_detect = {});
  const txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim() : "");
  const q = (sel, root = document) => {
    for (const s of sel.split("||")) {
      const el = root.querySelector(s.trim());
      if (el && txt(el)) return el;
    }
    return null;
  };
  const htmlToText = (html) => {
    const d = document.createElement("div");
    d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d)>/gi, "\n");
    return (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  };

  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch { continue; }
      const items = [].concat(data["@graph"] || data);
      for (const it of items) {
        if (!it || ![].concat(it["@type"]).includes("JobPosting")) continue;
        const loc = [].concat(it.jobLocation || []).map((l) => {
          const a = (l && l.address) || {};
          return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(", ");
        }).filter(Boolean).join(" | ");
        const sal = it.baseSalary && it.baseSalary.value;
        return {
          title: it.title || "",
          company: (it.hiringOrganization && (it.hiringOrganization.name || it.hiringOrganization)) || "",
          location: (it.jobLocationType === "TELECOMMUTE" ? "Remote " : "") + loc,
          description: htmlToText(it.description),
          posted: it.datePosted || "",
          salary: sal ? [sal.minValue, sal.maxValue].filter(Boolean).join("–") + " " + (it.baseSalary.currency || "") + " " + (sal.unitText || "") : "",
          via: "json-ld",
        };
      }
    }
    return null;
  }

  // Site adapters use attribute-substring selectors so small class renames don't break them.
  const ADAPTERS = [
    {
      host: /linkedin\.com$/,
      title: ".job-details-jobs-unified-top-card__job-title || .jobs-unified-top-card__job-title || .top-card-layout__title || h1",
      company: ".job-details-jobs-unified-top-card__company-name || .jobs-unified-top-card__company-name || .topcard__org-name-link",
      location: ".job-details-jobs-unified-top-card__primary-description-container || .job-details-jobs-unified-top-card__bullet || .topcard__flavor--bullet",
      description: "#job-details || .jobs-description__content || .description__text",
      contacts: ".hirer-card__hirer-information || .jobs-poster__name",
    },
    {
      host: /naukri\.com$/,
      title: '[class*="jd-header-title"] || h1',
      company: '[class*="jd-header-comp-name"] a || [class*="jd-header-comp-name"]',
      location: '[class*="jhc__location"] || [class*="location"]',
      description: '[class*="job-desc-container"] || [class*="dang-inner-html"] || section[class*="JDC"]',
      salary: '[class*="jhc__salary"] || [class*="salary"]',
    },
    { host: /indeed\.com$/, title: "h1.jobsearch-JobInfoHeader-title || h1", company: '[data-company-name="true"] || [data-testid="inlineHeader-companyName"]', location: '[data-testid="inlineHeader-companyLocation"] || [data-testid="job-location"]', description: "#jobDescriptionText" },
    { host: /greenhouse\.io$/, title: ".app-title || h1.section-header || h1", company: ".company-name || .company-name a", location: ".location || .job__location", description: "#content || .job__description || main" },
    { host: /lever\.co$/, title: ".posting-headline h2 || h2", company: ".main-header-logo img[alt] || title", location: ".posting-categories .location || .sort-by-time", description: ".posting-page .section-wrapper || .content" },
    { host: /ashbyhq\.com$/, title: "h1", company: '[class*="_navLogo"] img[alt] || title', location: '[class*="_location"] || [class*="location"]', description: '[class*="_descriptionText"] || [class*="description"] || main' },
    { host: /wellfound\.com$/, title: "h1", company: 'a[href*="/company/"] || h2', location: '[class*="location"]', description: '[class*="description"] || main' },
    { host: /instahyre\.com$/, title: "h1 || .job-title", company: ".company-name || h2", location: '[class*="location"]', description: '[class*="description"] || main' },
  ];

  D.getJobInfo = function () {
    const host = location.hostname.replace(/^www\./, "");
    const ld = fromJsonLd();
    const ad = ADAPTERS.find((a) => a.host.test(host));
    const job = { url: location.href, title: "", company: "", location: "", description: "", salary: "", posted: "", via: "", contacts: [] };
    if (ld) Object.assign(job, ld);
    if (ad) {
      const pick = (k) => {
        if (!ad[k]) return "";
        const el = q(ad[k]);
        if (!el) return "";
        if (el.tagName === "IMG") return el.alt || "";
        if (el.tagName === "TITLE") return document.title.split(/[-|–]/)[0].trim();
        return txt(el);
      };
      job.title = job.title || pick("title");
      job.company = job.company || pick("company");
      job.location = job.location || pick("location");
      const desc = pick("description");
      if (desc.length > (job.description || "").length) job.description = desc;
      job.salary = job.salary || pick("salary");
      if (ad.contacts) job.contacts = [...document.querySelectorAll(ad.contacts.split("||")[0].trim())].map((e) => ({ name: txt(e).split("\n")[0], url: (e.closest("a") || e.querySelector("a") || {}).href || "" })).filter((c) => c.name);
      job.via = job.via || "adapter";
    }
    if (!job.title) job.title = txt(document.querySelector("h1")) || document.title;
    if (!job.company) {
      const og = document.querySelector('meta[property="og:site_name"]');
      job.company = (og && og.content) || host.split(".").slice(-2, -1)[0] || host;
      job.company = job.company.replace(/\bcareers?\b|\bjobs?\b/gi, "").trim() || job.company;
    }
    if (!job.description || job.description.length < 200) {
      const main = document.querySelector("main, article, [role=main]") || document.body;
      job.description = txt(main).slice(0, 15000);
      job.via = job.via || "page";
    }
    job.title = job.title.split("\n")[0].slice(0, 160);
    job.company = job.company.split("\n")[0].slice(0, 120);
    job.location = job.location.split("\n")[0].slice(0, 160);
    job.description = job.description.slice(0, 15000);
    const emails = (job.description.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).filter((e) => !/noreply|no-reply|example/i.test(e));
    for (const e of [...new Set(emails)]) job.contacts.push({ name: "", email: e, url: "" });
    job.looksLikeJob = !!(ld || (ad && job.description.length > 300) || /responsibilit|requirement|qualification|what you.ll do|job description/i.test(job.description));
    job.isLinkedInProfile = /linkedin\.com\/in\//.test(location.href);
    return job;
  };

  D.getLinkedInProfile = function () {
    if (!/linkedin\.com\/in\//.test(location.href)) return null;
    const name = txt(document.querySelector("main h1")) || document.title.split("|")[0].trim();
    const headline = txt(document.querySelector("main .text-body-medium"));
    const exp = document.querySelector('#experience') && document.querySelector('#experience').closest("section");
    let company = "";
    if (exp) {
      const first = exp.querySelector('li span[aria-hidden="true"]:not(:first-child)') || exp.querySelectorAll('li span[aria-hidden="true"]')[1];
      company = first ? txt(first).split("·")[0].trim() : "";
    }
    if (!company) { const m = headline.match(/\b(?:at|@)\s+(.+)$/i); company = m ? m[1].split("|")[0].trim() : ""; }
    return { name, headline, company, url: location.href.split("?")[0] };
  };

  // ---------- form fields ----------
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "search"]);
  const SENSITIVE = /password|otp|captcha|cvv|card.?number|ssn|aadha?ar|pan.?(no|number|card)|passport|bank|ifsc|account.?number|pin$|security.?code/i;

  const NATIVE = "input, textarea, select, [contenteditable='true']";
  // Custom widgets that aren't real form fields: Workday/MUI dropdown buttons, ARIA radio groups, chat-bot answer chips
  const CUSTOM = 'button[aria-haspopup="listbox"], [aria-haspopup="listbox"]:not(input), [role="combobox"]:not(input), [role="radiogroup"], [role="checkbox"]:not(input), [role="switch"]:not(input), [class*="chatbot" i] [class*="chip" i]';
  const ANY_FIELD = "input:not([type=hidden]),select,textarea,[contenteditable='true']," + CUSTOM;
  D.CUSTOM = CUSTOM;

  function walk(root, out) {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, out);
      if (el.matches(NATIVE) || el.matches(CUSTOM)) out.push(el);
    }
  }
  D.visible = (el) => {
    if (el.type === "file") return true; // file inputs are often hidden behind styled buttons
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };

  function labelText(el) {
    const parts = [];
    const root = el.getRootNode();
    if (el.id && root.querySelector) {
      try { const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(txt(l)); } catch {}
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(txt(wrap));
    const lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach((id) => { const n = root.getElementById ? root.getElementById(id) : document.getElementById(id); if (n) parts.push(txt(n)); });
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    if (!parts.join("").trim()) {
      // nearest preceding text in the field's container (common in custom forms)
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        // stop once the container holds other fields: its text would describe them, not this one
        const others = [...p.querySelectorAll(ANY_FIELD)].filter((x) => x !== el && !el.contains(x) && !x.contains(el) && !(el.name && x.name === el.name));
        if (others.length) break;
        const clone = p.cloneNode(true);
        clone.querySelectorAll("input,select,textarea,option,button,script,style").forEach((n) => n.remove());
        const t = txt(clone);
        if (t && t.length < 220) { parts.push(t); break; }
        if (t.length >= 220) break;
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /** In chat-style flows (Naukri's apply bot) the question is the latest bot message above the answer box. */
  function chatQuestion(el) {
    const box = el.closest('[class*="chat" i]');
    if (!box) return "";
    let root = box;
    while (root.parentElement && /chat/i.test(root.parentElement.className || "")) root = root.parentElement;
    const before = [...root.querySelectorAll("*")].filter((n) => !n.children.length && n.textContent.trim().length > 3 && n.textContent.trim().length < 300 && !el.contains(n) && (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !/chip/i.test(n.className || ""));
    const q = [...before].reverse().find((n) => /\?\s*$/.test(n.textContent.trim()));
    return txt(q || before[before.length - 1]);
  }
  D.chatQuestion = chatQuestion;
  const cleanQ = (q) => String(q || "").replace(/\b(select one|required|please select|choose)\b/gi, "").replace(/\s+/g, " ").trim();
  const isEmptyText = (t) => !t || !t.trim() || /^(select( one)?|choose|please select|search|type to search)\b/i.test(t.trim()) || /^[-—\s]+$/.test(t);

  function customField(el, seen) {
    const role = el.getAttribute("role");
    if (el.matches('[class*="chip" i]')) {
      const parent = el.parentElement;
      if (!parent || seen.has(parent)) return null;
      seen.add(parent);
      const group = [...parent.children].filter((c) => /chip/i.test(c.className || "") && D.visible(c) && txt(c).length < 60);
      if (group.length < 2) return null;
      const question = chatQuestion(parent) || labelText(parent);
      return { el: parent, kind: "chips", question, descriptor: AM.norm(question), required: false, group, options: group.map(txt) };
    }
    if (role === "radiogroup") {
      if (el.querySelector("input")) return null; // real radios are handled natively
      const group = [...el.querySelectorAll('[role="radio"]')].filter(D.visible);
      if (group.length < 2) return null;
      const question = labelText(el) || chatQuestion(el);
      return { el, kind: "ariaradio", question, descriptor: AM.norm(question), required: el.getAttribute("aria-required") === "true" || /\*\s*$/.test(question), group, options: group.map(txt), checked: group.some((g) => g.getAttribute("aria-checked") === "true") };
    }
    if (role === "checkbox" || role === "switch") {
      const grp = el.parentElement && el.closest('[role="group"]');
      const sibs = grp ? [...grp.querySelectorAll('[role="checkbox"]:not(input)')].filter(D.visible) : [];
      if (sibs.length > 1) {
        // multi-select made of ARIA checkboxes ("Which of these have you used?")
        if (seen.has(grp)) return null;
        seen.add(grp);
        const question = labelText(grp) || chatQuestion(grp);
        return { el: grp, kind: "checkgroup", question, descriptor: AM.norm(question), required: grp.getAttribute("aria-required") === "true" || /\*\s*$/.test(question), group: sibs, options: sibs.map((s) => labelText(s) || txt(s)) };
      }
      const question = labelText(el) || txt(el);
      if (/terms|privacy|consent|agree|policy|subscribe|newsletter|marketing/i.test(question)) return null;
      return { el, kind: "ariacheck", question, descriptor: AM.norm(question), required: el.getAttribute("aria-required") === "true" };
    }
    // dropdown trigger (Workday button, MUI div combobox)
    if (el.querySelector("input:not([type=hidden]), select")) return null; // wraps a real input: handled natively
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return null;
    const label = labelText(el);
    const current = txt(el);
    const question = cleanQ(label.replace(current, "")) || cleanQ(label);
    if (!question) return null;
    return { el, kind: "customselect", question, descriptor: AM.norm(question + " " + (el.getAttribute("data-automation-id") || "")), required: el.getAttribute("aria-required") === "true" || /required|\*/i.test(label), current: isEmptyText(current) ? "" : current };
  }

  // ---------- widgets with no ARIA at all ----------
  const ACTION_WORDS = /\b(submit|next|continue|apply|save|cancel|back|upload|remove|delete|add|edit|close|sign|log ?in|search|browse|skip|clear|reset|download|share|view|show|more|less|send|done|ok)\b/i;
  const PLACEHOLDER = /^(select|choose|pick|please select|--|—|select an option|select one)/i;
  /** <div class="xyz-select">Select…▾</div> style dropdowns */
  function plainDropdowns(taken) {
    const out = [];
    const cands = [...document.querySelectorAll('[class*="select" i]:not(select):not(option):not(input), [class*="dropdown" i]:not(select), [class*="picker" i]:not(input)')];
    for (const el of cands) {
      if (!D.visible(el) || /option|item|menu|list|value-container|placeholder|indicator|arrow|icon|single-value/i.test(el.className || "")) continue;
      if (el.matches(CUSTOM) || el.closest(CUSTOM) || el.closest("nav, header, footer, select, [role=listbox], [role=menu]")) continue;
      if (el.querySelector("input:not([type=hidden]), select, textarea, " + CUSTOM)) continue;
      const t = txt(el);
      if (t.length > 50 || t.includes("\n")) continue;
      const cs = getComputedStyle(el);
      const clickable = cs.cursor === "pointer" || el.tabIndex >= 0 || el.tagName === "BUTTON" || [...el.querySelectorAll("*")].some((c) => getComputedStyle(c).cursor === "pointer");
      if (!clickable) continue;
      if (out.some((o) => o.contains(el)) || taken.some((x) => x === el || x.contains(el) || el.contains(x))) continue;
      for (let i = out.length - 1; i >= 0; i--) if (el.contains(out[i])) out.splice(i, 1); // keep the outermost control
      out.push(el);
    }
    return out
      .map((el) => {
        const label = labelText(el);
        const current = txt(el);
        const question = cleanQ(label.replace(current, "")) || "";
        if (!question || question.length < 3) return null;
        return { el, kind: "customselect", question, descriptor: AM.norm(question), required: /\*|required/i.test(label), current: !current || PLACEHOLDER.test(current) ? "" : current, plain: true };
      })
      .filter(Boolean);
  }
  /** "Yes / No" (or "0-2 / 2-5 / 5+") rows made of plain buttons */
  function buttonGroups(taken) {
    const out = [];
    const seen = new Set();
    for (const b of document.querySelectorAll('button:not([type="submit"]), [role="button"]')) {
      const p = b.parentElement;
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (p.closest("nav, header, footer, form [type=submit], [role=toolbar], [role=tablist], [role=dialog] > footer") || p.closest(CUSTOM)) continue;
      const btns = [...p.children].filter((c) => (c.matches('button:not([type="submit"]), [role="button"]')) && D.visible(c));
      if (btns.length < 2 || btns.length > 8 || btns.length !== [...p.children].filter(D.visible).length) continue;
      const texts = btns.map(txt);
      if (texts.some((t) => !t || t.length > 30 || ACTION_WORDS.test(t))) continue;
      if (taken.some((x) => x === p || p.contains(x))) continue;
      const question = labelText(p) || chatQuestion(p);
      if (!question || question.length < 4) continue;
      out.push({ el: p, kind: "buttongroup", question, descriptor: AM.norm(question), required: /\*\s*$/.test(question), group: btns, options: texts });
    }
    return out;
  }

  function groupQuestion(el) {
    const fs = el.closest("fieldset");
    if (fs) { const lg = fs.querySelector("legend"); if (lg) return txt(lg); }
    const rg = el.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const id = rg.getAttribute("aria-labelledby");
      if (id && document.getElementById(id)) return txt(document.getElementById(id));
      if (rg.getAttribute("aria-label")) return rg.getAttribute("aria-label");
    }
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      const radios = p.querySelectorAll(`input[name="${CSS.escape(el.name || "")}"]`);
      if (radios.length > 1 || i === 4) {
        const clone = p.cloneNode(true);
        clone.querySelectorAll("input,label,option,script,style").forEach((n) => n.remove());
        const t = txt(clone);
        if (t && t.length < 300) return t;
      }
    }
    return "";
  }

  /** returns [{el, kind, question, descriptor, required, options?, group?}] */
  D.collectFields = function () {
    const raw = [];
    walk(document, raw);
    const seenGroups = new Set();
    const seenChips = new Set();
    const fields = [];
    for (const el of raw) {
      if (!el.matches(NATIVE)) {
        if (!D.visible(el)) continue;
        const cf = customField(el, seenChips);
        if (cf && !SENSITIVE.test(cf.question)) fields.push(cf);
        continue;
      }
      const type = (el.type || "").toLowerCase();
      if (el.tagName === "INPUT" && SKIP_TYPES.has(type)) continue;
      if (el.disabled || el.readOnly) continue;
      if (!D.visible(el)) continue;
      const attrs = [el.name, el.id, el.placeholder, el.getAttribute("autocomplete"), el.getAttribute("data-automation-id"), el.getAttribute("data-qa")].filter(Boolean).join(" ");
      if (SENSITIVE.test(attrs)) continue;
      let kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" || el.isContentEditable ? "textarea" : type === "file" ? "file" : type === "radio" ? "radio" : type === "checkbox" ? "checkbox" : type === "date" ? "date" : "text";
      if (kind === "text" && (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list")) kind = "combobox";
      if (kind === "radio" || kind === "checkbox") {
        const key = (el.name || "") + "|" + (el.closest("form") ? "f" : "");
        if (el.name && seenGroups.has(key)) continue;
        const group = el.name ? [...(el.getRootNode().querySelectorAll ? el.getRootNode() : document).querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)] : [el];
        if (el.name) seenGroups.add(key);
        if (kind === "checkbox" && group.length === 1) {
          const lt = labelText(el);
          if (/terms|privacy|consent|agree|policy|subscribe|newsletter|marketing/i.test(lt)) continue; // never tick legal / consent boxes
          fields.push({ el, kind: "checkbox", question: lt, descriptor: AM.norm(lt + " " + attrs), required: el.required, group });
          continue;
        }
        const question = groupQuestion(el) || labelText(el);
        if (/terms|privacy|consent|agree to|policy/i.test(question)) continue;
        // several checkboxes sharing a name = multi-select ("Which of these technologies…")
        fields.push({ el, kind: kind === "checkbox" ? "checkgroup" : kind, question, descriptor: AM.norm(question + " " + attrs), required: group.some((g) => g.required), group, options: group.map((g) => labelText(g) || g.value) });
        continue;
      }
      const lt = labelText(el) || (el.isContentEditable ? chatQuestion(el) : "");
      const question = lt || el.placeholder || el.getAttribute("aria-label") || el.getAttribute("data-placeholder") || el.name || "";
      const required = el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(lt);
      const f = { el, kind, question, descriptor: AM.norm([lt, el.placeholder, el.name, el.id, el.getAttribute("autocomplete")].filter(Boolean).join(" ")), required, ac: (el.getAttribute("autocomplete") || "").toLowerCase() };
      if (kind === "select") f.options = [...el.options].map((o) => o.text.trim());
      fields.push(f);
    }
    // widgets with no ARIA: plain div dropdowns and Yes/No button rows
    try {
      const taken = fields.map((f) => f.el).concat(fields.flatMap((f) => f.group || []));
      fields.push(...plainDropdowns(taken));
      fields.push(...buttonGroups(fields.map((f) => f.el).concat(fields.flatMap((f) => f.group || []))));
    } catch {}
    // in a chat bot, the free-text box repeats the chip question: keep only the chips
    const chipQs = new Set(fields.filter((f) => f.kind === "chips").map((f) => f.question));
    return fields.filter((f) => !(f.kind === "textarea" && f.el.isContentEditable && chipQs.has(f.question)));
  };

  D.fieldSignature = (f) => AM.norm((f.question || "").slice(0, 80) + "|" + (f.el.name || f.el.id || ""));

  D.looksLikeApplicationForm = function () {
    const fields = D.collectFields();
    if (fields.length < 3) return false;
    const d = fields.map((f) => f.descriptor).join(" ");
    const hasName = /name/.test(d), hasEmail = /email|e mail/.test(d), hasFile = fields.some((f) => f.kind === "file");
    return (hasName && hasEmail) || (hasFile && (hasName || hasEmail));
  };
})();
