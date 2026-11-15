/* Auto-fill engine. Fills fields only; never clicks submit / next / apply. */
(function () {
  if (window.__AM_fill) return;
  const D = window.__AM_detect;
  const COLORS = { ok: "#16a34a", review: "#d97706", missing: "#dc2626", skipped: "#2563eb" };
  window.__AM_filled = new WeakSet(); // elements we filled from profile/answers
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- low level setters (work with React/Vue/Angular controlled inputs) ----------
  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }
  function setValue(el, value) {
    value = String(value ?? "");
    if (el.isContentEditable) {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, value);
      fire(el, "input");
      return;
    }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus({ preventScroll: true });
    setter.call(el, value);
    fire(el, "input");
    fire(el, "change");
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }
  function mark(el, state) {
    const target = el.type === "radio" || el.type === "checkbox" ? el.closest("fieldset, [role=radiogroup], [role=group]") || el.parentElement : el.type === "file" ? el.closest("div, label") || el : el.matches && el.matches('[role="radio"], [role="checkbox"]') ? el.parentElement : el;
    if (!target || !target.style) return;
    target.style.outline = `2px ${state === "skipped" ? "dashed" : "solid"} ${COLORS[state]}`;
    target.style.outlineOffset = "2px";
    target.dataset.amState = state;
    if (state === "missing") target.title = "ApplyMate: required, please fill this one";
    if (state === "skipped") target.title = "ApplyMate: optional, no answer in your profile yet (try 'Answer the rest with AI')";
  }
  D.clearMarks = () => document.querySelectorAll("[data-am-state]").forEach((n) => { n.style.outline = ""; delete n.dataset.amState; });

  // ---------- matching a field to a profile key ----------
  const AC_MAP = {};
  for (const f of AM.FIELDS) for (const a of f.ac || []) AC_MAP[a] = f.key;
  const hasPhrase = (hay, phrase) => (" " + hay + " ").includes(" " + phrase + " ");

  function matchKey(f, siteMap) {
    const sig = D.fieldSignature(f);
    if (siteMap && siteMap[sig]) return { key: siteMap[sig], score: 100, mapped: true };
    if (f.kind === "file") {
      return { key: /cover/.test(f.descriptor) ? "coverLetterFile" : "resume", score: 50 };
    }
    if (f.ac && AC_MAP[f.ac] && f.ac !== "on" && f.ac !== "off") return { key: AC_MAP[f.ac], score: 60 };
    const q = AM.norm(f.question);
    let best = null, bestScore = 0;
    for (const def of AM.FIELDS) {
      if (def.kind === "file") continue;
      if (f.kind === "textarea" && (def.kind === "number" || def.kind === "bool")) continue;
      // a Yes/No choice can't take a number: "Do you have hands-on experience with Kafka?" is not "total experience"
      if (def.kind === "number" && f.options && f.options.length && f.options.every((o) => /^\s*(yes|no)\b/i.test(o) || isPlaceholder(o))) continue;
      for (const s of def.syn) {
        let sc = 0;
        if (hasPhrase(q, s)) sc = s.length + 6;
        else if (hasPhrase(f.descriptor, s)) sc = s.length;
        if (sc > bestScore) { bestScore = sc; best = def.key; }
      }
    }
    // Long, specific questions ("Describe your experience with React…") should go to the answer bank instead.
    if (best && q.length > 70 && bestScore < 14) return null;
    if (best === "fullName" && /company|school|college|university|reference|referr|manager|father|mother|spouse/.test(q)) return null;
    return best ? { key: best, score: bestScore } : null;
  }

  // ---------- option choosing for select / radio ----------
  const isPlaceholder = (t) => !t || /^(select|choose|please select|--|—|none selected|pick)/i.test(t.trim());
  function optRange(text, key) {
    const t = text.toLowerCase();
    if (/immediate|^0\b|currently serving|serving notice/.test(t)) return [0, 0];
    const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null;
    let mult = 1;
    if (key === "noticePeriod" && /month/.test(t)) mult = 30;
    if (key === "noticePeriod" && /week/.test(t)) mult = 7;
    const a = nums[0] * mult, b = (nums[1] ?? nums[0]) * mult;
    if (/\+|more than|above|over/.test(t)) return [a, 999];
    if (/less than|under|below|upto|up to/.test(t)) return [0, a];
    return [Math.min(a, b), Math.max(a, b)];
  }
  function chooseOption(options, value, key, kind) {
    const idx = options.map((o, i) => [o, i]).filter(([o]) => !isPlaceholder(o));
    if (!idx.length) return -1;
    if (kind === "bool" || typeof value === "boolean") {
      const want = value === true || /^(yes|true|y)$/i.test(String(value));
      const hit = idx.find(([o]) => (want ? /^\s*(yes|y|true|i am|i do|i will|willing|authori[sz]ed)\b/i : /^\s*(no|n|false|i am not|i do not|i don.t|not)\b/i).test(o));
      return hit ? hit[1] : -1;
    }
    const v = String(value ?? "").trim();
    if (!v) return -1;
    const num = parseFloat(v);
    if (!isNaN(num) && ["totalExperience", "relevantExperience", "noticePeriod", "currentCTC", "expectedCTC", "gradYear"].includes(key)) {
      let best = -1, bestDist = Infinity;
      for (const [o, i] of idx) {
        const r = optRange(o, key);
        if (!r) continue;
        const dist = num >= r[0] && num <= r[1] ? 0 : Math.min(Math.abs(num - r[0]), Math.abs(num - r[1]));
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      if (best >= 0) return best;
    }
    const nv = AM.norm(v);
    let exact = idx.find(([o]) => AM.norm(o) === nv);
    if (exact) return exact[1];
    if (/prefer not|decline/i.test(v)) { const h = idx.find(([o]) => /prefer not|decline|rather not|don.t wish/i.test(o)); if (h) return h[1]; }
    let best = -1, bestS = 0;
    const firstTok = AM.tokens(v)[0];
    for (const [o, i] of idx) {
      const no = AM.norm(o);
      let s = no.includes(nv) || nv.includes(no) ? 0.9 : AM.similarity(o, v);
      if (firstTok && firstTok.length > 2 && AM.tokens(o).includes(firstTok)) s = Math.max(s, 0.6); // "B.Tech Computer Science" → "B.Tech / B.E."
      if (s > bestS) { bestS = s; best = i; }
    }
    return bestS >= 0.5 ? best : -1;
  }

  // ---------- value for a key ----------
  function valueFor(key, f, profile, opts) {
    const def = AM.FIELD_MAP[key] || {};
    if (key === "coverLetter") return opts.coverLetter || "";
    if (key === "summary") return profile.summary || "";
    let v = AM.profileValue(profile, key);
    if (v === undefined || v === null || v === "") return "";
    if (def.kind === "bool") return !!v;
    if (def.kind === "number" && (f.kind === "text" || f.kind === "combobox")) {
      const n = parseFloat(v);
      if (isNaN(n)) return v;
      const d = f.descriptor;
      if (f.el.type === "number") {
        if ((key === "currentCTC" || key === "expectedCTC") && /inr|rupee|per annum|annual|₹/.test(d) && !/lpa|lakh|lac/.test(d) && n < 300) return String(Math.round(n * 100000));
        return String(n);
      }
      if (key === "noticePeriod") return /day/.test(d) ? String(n) : /month/.test(d) ? String(Math.round(n / 30)) : `${n} days`;
      if (key === "currentCTC" || key === "expectedCTC") return /lpa|lakh|lac/.test(d) ? String(n) : /inr|rupee|per annum|annual|₹/.test(d) && n < 300 ? String(Math.round(n * 100000)) : `${n} LPA`;
      if (key === "totalExperience" || key === "relevantExperience") return /month/.test(d) && !/year/.test(d) ? String(Math.round(n * 12)) : String(n);
    }
    if (f.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return v;
    return String(v);
  }

  async function b64File(fileId) {
    if (!fileId) return null;
    const rec = await AM.get("file:" + fileId, null);
    if (!rec) return null;
    const bin = atob(rec.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], rec.name, { type: rec.type || "application/pdf" });
  }
  async function setFile(el, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    fire(el, "input");
    fire(el, "change");
  }

  // ---------- custom widgets (Workday / MUI / react-select / plain div dropdowns / ARIA / chat chips) ----------
  /** A click as a real mouse would do it: some widgets listen to pointerdown/mousedown, others to click. */
  function realClick(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    let r = el.getBoundingClientRect();
    // hit what a real mouse would hit (the inner "control" div often owns the click handler)
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && hit !== el && el.contains(hit)) { el = hit; r = el.getBoundingClientRect(); }
    else if (!hit || !el.contains(hit)) {
      // tab not painted (background) or overlay: use the outermost part that shows a hand cursor
      const ptr = [el, ...el.querySelectorAll("*")].find((n) => getComputedStyle(n).cursor === "pointer" && n.getBoundingClientRect().width > 0);
      if (ptr && ptr !== el) { el = ptr; r = el.getBoundingClientRect(); }
    }
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }
  const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== "hidden"; };
  const optText = (o) => (o.innerText || o.textContent || "").replace(/\s+/g, " ").trim();
  function popupFor(trigger) {
    const id = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
    const byId = id && document.getElementById(id);
    if (byId && shown(byId)) return byId;
    const lists = [...document.querySelectorAll('[role="listbox"], [role="menu"]')].filter(shown);
    return lists[lists.length - 1] || null; // popups are usually appended last
  }
  function ariaOptions(trigger) {
    const scope = popupFor(trigger) || document;
    return [...scope.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]')].filter((o) => shown(o) && !o.closest("select") && optText(o) && o.getAttribute("aria-disabled") !== "true");
  }
  // Dropdowns built without ARIA: the options are whatever short, clickable items appeared after we clicked.
  const OPTION_LIKE = 'li, [class*="option" i], [class*="item" i], [class*="menu" i] > *, [class*="list" i] > *, [class*="dropdown" i] > *, [class*="choice" i]';
  const snapshot = () => new Set(document.querySelectorAll(OPTION_LIKE));
  function appearedOptions(before, trigger) {
    const out = [];
    for (const n of document.querySelectorAll(OPTION_LIKE)) {
      if (before.has(n) || n.contains(trigger) || !shown(n)) continue;
      const t = optText(n);
      if (!t || t.length > 90 || n.querySelector("input:not([type=hidden]),select,textarea")) continue;
      if (out.some((o) => o.contains(n))) continue; // keep the outermost option element
      for (let i = out.length - 1; i >= 0; i--) if (n.contains(out[i])) out.splice(i, 1);
      out.push(n);
    }
    return out;
  }
  const optionsNow = (trigger, before) => { const a = ariaOptions(trigger); return a.length ? a : before ? appearedOptions(before, trigger) : []; };
  async function waitFor(fn, ms = 1500, step = 80) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step); }
    return fn();
  }
  function closePopup(trigger) {
    for (const t of [document.activeElement, trigger, document.body]) t && t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  }
  const asText = (v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v));

  /** Open a dropdown (button, div, anything), search if it has a search box, click the best option. */
  async function fillCustomSelect(trigger, value, key, kind) {
    const before = snapshot();
    const focusedBefore = document.activeElement;
    realClick(trigger);
    let opts = await waitFor(() => { const o = optionsNow(trigger, before); return o.length ? o : null; });
    if (!opts) {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
      opts = await waitFor(() => { const o = optionsNow(trigger, before); return o.length ? o : null; }, 800);
    }
    opts = opts || [];
    let i = chooseOption(opts.map(optText), value, key, kind);
    if (i < 0) {
      // long lists (country, city, college) usually have a search box inside the popup
      const pop = popupFor(trigger);
      const ae = document.activeElement;
      // only a search box that belongs to this dropdown: inside its popup, or one that got focus when it opened
      const near = (n) => n && (trigger.contains(n) || (pop && pop.contains(n)) || (trigger.parentElement && trigger.parentElement.contains(n)));
      const search = (pop && [...pop.querySelectorAll("input:not([type=hidden])")].find(shown)) || (ae && ae.tagName === "INPUT" && ae !== trigger && ae !== focusedBefore && near(ae) ? ae : null);
      if (search) {
        const term = asText(value).split(/[,(|]/)[0].trim();
        setValue(search, term);
        search.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: term.slice(-1) }));
        opts = await waitFor(() => { const o = optionsNow(trigger, before); return o.length && o.some((x) => AM.norm(optText(x)).includes(AM.norm(term).split(" ")[0])) ? o : null; }, 1500);
        opts = opts || optionsNow(trigger, before);
        i = chooseOption(opts.map(optText), value, key, kind);
        if (i < 0 && opts.length === 1) i = 0;
      }
    }
    if (i < 0) { closePopup(trigger); return false; }
    realClick(opts[i]);
    await sleep(150);
    if (popupFor(trigger) && trigger.getAttribute("aria-expanded") === "true") closePopup(trigger);
    return true;
  }
  async function fillCombobox(el, text) {
    const before = snapshot();
    setValue(el, text);
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    const opts = await waitFor(() => { const o = optionsNow(el, before); return o.length ? o : null; }, 1800);
    if (!opts) return false;
    const i = chooseOption(opts.map(optText), text, "", "text");
    if (i < 0 && opts.length > 1) return false;
    realClick(opts[i >= 0 ? i : 0]);
    await sleep(100);
    return true;
  }
  const isOn = (n) => (n.tagName === "INPUT" ? n.checked : n.getAttribute("aria-checked") === "true" || n.getAttribute("aria-pressed") === "true" || n.getAttribute("aria-selected") === "true" || /\b(active|selected|checked|is-checked|on)\b/i.test(n.className || ""));
  const toggle = (n) => (n.tagName === "INPUT" ? n.click() : realClick(n));
  /** which options of a multi-select to tick: a list of texts, or for skills questions, everything you know */
  function pickMany(options, value) {
    const wanted = Array.isArray(value) ? value : String(value).split(/\s*[|,;]\s*|\n/).filter(Boolean);
    const idx = new Set();
    for (const w of wanted) { const i = chooseOption(options, w, "", "text"); if (i >= 0) idx.add(i); }
    return [...idx];
  }
  /** Date fields with a visible format (DD/MM/YYYY, MM-DD-YYYY…) */
  function formatDate(iso, hint) {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    const h = String(hint || "").toLowerCase();
    if (/mm[\/\-.]dd/.test(h)) return `${m[2]}/${m[3]}/${m[1]}`.replace(/\//g, h.includes("-") ? "-" : "/");
    if (/dd[\/\-.]mm/.test(h)) return `${m[3]}/${m[2]}/${m[1]}`.replace(/\//g, h.includes("-") ? "-" : "/");
    return iso;
  }

  /** Put one value into one field, whatever kind it is. Returns true/false, or "suggested" for chat chips. */
  async function fillField(f, value, key, kindOfKey) {
    const el = f.el;
    switch (f.kind) {
      case "select": {
        const i = chooseOption(f.options, value, key, kindOfKey);
        if (i < 0) return false;
        setValue(el, el.options[i].value);
        return true;
      }
      case "radio":
      case "ariaradio":
      case "buttongroup": {
        const i = chooseOption(f.options, value, key, kindOfKey);
        if (i < 0) return false;
        if (!isOn(f.group[i])) toggle(f.group[i]);
        return true;
      }
      case "checkbox":
      case "ariacheck": {
        const want = value === true || /^(yes|true|y|agree|i do|i have|i am)\b/i.test(String(value));
        if (isOn(el) !== want) toggle(el);
        return true;
      }
      case "checkgroup": {
        const picks = pickMany(f.options, value);
        if (!picks.length) return false;
        for (const i of picks) if (!isOn(f.group[i])) toggle(f.group[i]);
        return true;
      }
      case "combobox": {
        if (key === "skills" || Array.isArray(value)) {
          // tag pickers: add skills one by one
          const list = (Array.isArray(value) ? value : AM.splitList(value)).slice(0, 8);
          let any = false;
          for (const s of list) any = (await fillCombobox(el, s)) || any;
          return any;
        }
        return (await fillCombobox(el, asText(value))) || !!el.value;
      }
      case "customselect":
        return fillCustomSelect(el, value, key, kindOfKey);
      case "chips": {
        // Chat chips send the answer the moment they're clicked, so we only point at our suggestion.
        const i = chooseOption(f.options, value, key, kindOfKey);
        if (i < 0) return false;
        const chip = f.group[i];
        chip.style.outline = `3px solid ${COLORS.review}`;
        chip.style.outlineOffset = "2px";
        chip.dataset.amState = "review";
        chip.title = "ApplyMate suggests this answer: click it to send";
        return "suggested";
      }
      default: {
        let v = asText(value);
        if ((key === "dob" || key === "lastWorkingDay") && f.kind !== "date") v = formatDate(v, (el.placeholder || "") + " " + f.question);
        setValue(el, v);
        return true;
      }
    }
  }

  /** Does the field already hold something (filled by the user or the site)? */
  function hasValue(f) {
    const el = f.el;
    switch (f.kind) {
      case "select": return el.selectedIndex > 0 && !isPlaceholder(el.options[el.selectedIndex].text);
      case "file": return !!(el.files && el.files.length);
      case "customselect": return !!f.current;
      case "radio": case "ariaradio": case "buttongroup": case "checkgroup": return f.group.some(isOn);
      case "checkbox": case "ariacheck": return false; // unchecked is a valid state; we decide per question
      case "chips": return false;
      default: return !!(el.value || (el.isContentEditable && el.textContent.trim()));
    }
  }

  // ---------- main ----------
  window.__AM_unanswered = new Map(); // signature -> field description, for "answer the rest with AI"
  window.__AM_fill = async function (opts = {}) {
    const [profile, answers, siteMaps] = await Promise.all([AM.getProfile(), AM.get("answers", []), AM.get("siteMaps", {})]);
    const siteMap = siteMaps[location.hostname] || {};
    const vars = { company: opts.company || "", role: opts.role || "", first: profile.firstName, me: AM.profileValue(profile, "fullName") };
    const fields = D.collectFields();
    const summary = { frame: location.hostname, total: 0, filled: 0, review: 0, missing: [], unanswered: [], suggested: 0 };
    window.__AM_unanswered.clear();
    for (const f of fields) {
      const el = f.el;
      if (hasValue(f) && !window.__AM_filled.has(el)) continue; // never overwrite your own input
      summary.total++;
      let m = matchKey(f, siteMap);
      // A near-identical saved answer beats a loose profile match (e.g. "Why are you leaving?" vs cover letter).
      if (m && !m.mapped && f.kind !== "file" && f.question && m.score < 22) {
        const strong = AM.findAnswer(answers, f.question, 0.75);
        if (strong) m = { key: "answer:" + strong.answer.id, score: 30 };
      }
      let value, state = "ok", key = m && m.key;
      if (key === "skip") continue;
      if (key && key.startsWith("answer:")) {
        const a = answers.find((x) => x.id === key.slice(7));
        value = a ? AM.fillTemplate(a.a, vars) : "";
        key = null;
        if (!m.mapped) state = "review";
      } else if (key) {
        if (f.kind === "file") {
          const fileId = key === "coverLetterFile" ? opts.coverLetterFileId : opts.resumeFileId || profile.defaultResumeId;
          const file = await b64File(fileId);
          if (file) { await setFile(el, file); window.__AM_filled.add(el); mark(el, "ok"); summary.filled++; }
          else if (f.required) { mark(el, "missing"); summary.missing.push(f.question || "Resume upload"); }
          continue;
        }
        value = valueFor(key, f, profile, opts);
      }
      if ((value === "" || value === undefined) && f.question) {
        const hit = AM.findAnswer(answers, f.question);
        if (hit) { value = AM.fillTemplate(hit.answer.a, vars); state = "review"; key = null; }
      }
      // Still nothing: work the answer out from the profile ("Do you know React?", "Years with Node?", "Can you join in 30 days?"…)
      if ((value === "" || value === undefined || value === null) && f.question && f.kind !== "file") {
        const r = AM.ruleAnswer(f.question, f.options, profile, f.kind);
        if (r) { value = r.value; state = "review"; key = r.key || null; }
      }
      if (m && m.score < 9 && !m.mapped) state = "review"; // matched only via name/id attributes, not the visible label
      let ok = false;
      const attempt = async () => {
        if (value === "" || value === undefined || value === null || (Array.isArray(value) && !value.length)) return false;
        const kindOfKey = key ? (AM.FIELD_MAP[key] || {}).kind : typeof value === "boolean" ? "bool" : "text";
        try { return await fillField(f, value, key, kindOfKey); } catch (e) { return false; }
      };
      ok = await attempt();
      // the profile value didn't fit (e.g. "experience" matched, but the options are Yes/No): reason it out instead
      if (!ok && f.question && f.kind !== "file") {
        const r = AM.ruleAnswer(f.question, f.options, profile, f.kind);
        if (r && String(r.value) !== String(value)) { value = r.value; key = r.key || null; state = "review"; ok = await attempt(); }
      }
      if (ok === "suggested") { summary.suggested++; continue; }
      if (ok) {
        window.__AM_filled.add(el);
        if (f.group) f.group.forEach((g) => window.__AM_filled.add(g));
        mark(el, state);
        summary.filled++;
        if (state === "review") summary.review++;
        continue;
      }
      // Couldn't answer: required → red; optional → blue dashed. Both are listed for "answer the rest with AI".
      if (f.kind === "checkbox" || f.kind === "ariacheck") { if (!f.required) continue; } // an untouched optional tick box is a valid answer
      const sig = D.fieldSignature(f);
      const item = { sig, question: (f.question || el.name || "(unlabelled field)").slice(0, 300), kind: f.kind, options: (f.options || []).filter((o) => !isPlaceholder(o)).slice(0, 40), required: !!f.required };
      window.__AM_unanswered.set(sig, item);
      summary.unanswered.push(item);
      if (f.required) { mark(el, "missing"); summary.missing.push(item.question); }
      else mark(el, "skipped");
    }
    window.__AM_lastFill = { at: Date.now(), opts };
    if (summary.filled) chrome.runtime.sendMessage({ type: "filled", summary }).catch(() => {});
    return summary;
  };

  /** Fill answers worked out elsewhere (AI reply pasted in the side panel), and remember them in the answer bank. */
  window.__AM_applyAnswers = async function (bySig) {
    const fields = D.collectFields();
    const answers = await AM.get("answers", []);
    let filled = 0, suggested = 0;
    for (const f of fields) {
      const sig = D.fieldSignature(f);
      if (!(sig in bySig)) continue;
      const raw = String(bySig[sig]).trim();
      if (!raw) continue;
      const value = /^(yes|no)$/i.test(raw) ? /^yes$/i.test(raw) : raw;
      let ok = false;
      try { ok = await fillField(f, value, null, typeof value === "boolean" ? "bool" : "text"); } catch {}
      if (ok === "suggested") { suggested++; continue; }
      if (!ok) continue;
      window.__AM_filled.add(f.el);
      if (f.group) f.group.forEach((g) => window.__AM_filled.add(g));
      mark(f.el, "review");
      filled++;
      window.__AM_unanswered.delete(sig);
      const q = (f.question || "").replace(/\s*\*\s*$/, "").slice(0, 300);
      if (q.length > 3) {
        const hit = AM.findAnswer(answers, q, 0.85);
        if (hit) { hit.answer.a = raw; hit.answer.updatedAt = AM.today(); }
        else answers.unshift({ id: AM.uid(), q, a: raw, updatedAt: AM.today(), uses: 0 });
      }
    }
    await AM.set("answers", answers);
    return { filled, suggested };
  };
  window.__AM_getUnanswered = () => [...window.__AM_unanswered.values()];

  // ---------- manual mapping via right-click menu ----------
  let lastRightClicked = null;
  document.addEventListener("contextmenu", (e) => { lastRightClicked = e.composedPath()[0]; }, true);
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type !== "mapField" || !lastRightClicked) return;
    (async () => {
      const f = D.collectFields().find((x) => x.el === lastRightClicked || (x.group && x.group.includes(lastRightClicked)));
      if (!f) return reply({ ok: false });
      const siteMaps = await AM.get("siteMaps", {});
      siteMaps[location.hostname] = siteMaps[location.hostname] || {};
      siteMaps[location.hostname][D.fieldSignature(f)] = msg.key;
      await AM.set("siteMaps", siteMaps);
      if (msg.key !== "skip") {
        window.__AM_filled.delete(f.el);
        f.el.value && f.kind !== "select" && setValue(f.el, "");
        await window.__AM_fill(window.__AM_lastFill ? window.__AM_lastFill.opts : {});
      }
      reply({ ok: true });
    })();
    return true;
  });

  window.__AM_test = { matchKey, chooseOption, valueFor, fillField };
})();
