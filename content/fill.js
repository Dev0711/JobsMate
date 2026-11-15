/* Auto-fill engine. Fills fields only; never clicks submit / next / apply. */
(function () {
  if (window.__AM_fill) return;
  const D = window.__AM_detect;
  const COLORS = { ok: "#16a34a", review: "#d97706", missing: "#dc2626" };
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
    const target = el.type === "radio" || el.type === "checkbox" ? el.closest("fieldset, [role=radiogroup], [role=group]") || el.parentElement : el.type === "file" ? el.closest("div, label") || el : el;
    if (!target || !target.style) return;
    target.style.outline = `2px solid ${COLORS[state]}`;
    target.style.outlineOffset = "2px";
    target.dataset.amState = state;
    if (state === "missing") target.title = "ApplyMate: please fill this one";
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

  // ---------- custom widgets (Workday / MUI / react-select / ARIA radios / chat chips) ----------
  /** A click as a real mouse would do it: some widgets listen to pointerdown/mousedown, others to click. */
  function realClick(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
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
  function visibleOptions(trigger) {
    const scope = popupFor(trigger) || document;
    return [...scope.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]')].filter((o) => shown(o) && !o.closest("select") && optText(o) && o.getAttribute("aria-disabled") !== "true");
  }
  async function waitFor(fn, ms = 1500, step = 80) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step); }
    return fn();
  }
  function closePopup(trigger) {
    for (const t of [document.activeElement, trigger, document.body]) t && t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  }
  /** Open a button/div dropdown, search if it has a search box, click the best option. */
  async function fillCustomSelect(trigger, value, key, kind) {
    realClick(trigger);
    let opts = await waitFor(() => { const o = visibleOptions(trigger); return o.length ? o : null; });
    if (!opts && trigger.getAttribute("aria-expanded") !== "true") {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
      opts = await waitFor(() => { const o = visibleOptions(trigger); return o.length ? o : null; }, 800);
    }
    opts = opts || [];
    let i = chooseOption(opts.map(optText), value, key, kind);
    if (i < 0) {
      // long lists (country, city, college) usually have a search box inside the popup
      const pop = popupFor(trigger);
      const ae = document.activeElement;
      const search = (pop && [...pop.querySelectorAll("input:not([type=hidden])")].find(shown)) || (ae && ae.tagName === "INPUT" && ae !== trigger ? ae : null);
      if (search) {
        const term = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).split(/[,(]/)[0].trim();
        setValue(search, term);
        search.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: term.slice(-1) }));
        opts = await waitFor(() => { const o = visibleOptions(trigger); return o.length && o.some((x) => AM.norm(optText(x)).includes(AM.norm(term).split(" ")[0])) ? o : null; }, 1500);
        opts = opts || visibleOptions(trigger);
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
    setValue(el, text);
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    const opts = await waitFor(() => { const o = visibleOptions(el); return o.length ? o : null; }, 1800);
    if (!opts) return false;
    const i = chooseOption(opts.map(optText), text, "", "text");
    if (i < 0 && opts.length > 1) return false;
    realClick(opts[i >= 0 ? i : 0]);
    await sleep(100);
    return true;
  }

  // ---------- main ----------
  window.__AM_fill = async function (opts = {}) {
    const [profile, answers, siteMaps] = await Promise.all([AM.getProfile(), AM.get("answers", []), AM.get("siteMaps", {})]);
    const siteMap = siteMaps[location.hostname] || {};
    const vars = { company: opts.company || "", role: opts.role || "", first: profile.firstName, me: AM.profileValue(profile, "fullName") };
    const fields = D.collectFields();
    const summary = { frame: location.hostname, total: 0, filled: 0, review: 0, missing: [] };
    for (const f of fields) {
      const el = f.el;
      // don't overwrite something the user (or the site) already filled
      if (["text", "textarea", "date", "combobox"].includes(f.kind) && (el.value || (el.isContentEditable && el.textContent.trim())) && !window.__AM_filled.has(el)) continue;
      if (f.kind === "select" && el.selectedIndex > 0 && !window.__AM_filled.has(el)) continue;
      if (f.kind === "file" && el.files && el.files.length) continue;
      if (f.kind === "customselect" && f.current && !window.__AM_filled.has(el)) continue;
      if (f.kind === "ariaradio" && f.checked && !window.__AM_filled.has(el)) continue;
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
      if (value === "" || value === undefined || value === null) {
        if (f.required) { mark(el, "missing"); summary.missing.push(f.question || el.name || "(unlabelled field)"); }
        continue;
      }
      if (m && m.score < 9 && !m.mapped) state = "review"; // matched only via name/id attributes, not the visible label
      const kindOfKey = key ? (AM.FIELD_MAP[key] || {}).kind : typeof value === "boolean" ? "bool" : "text";
      let ok = false;
      try {
        if (f.kind === "select") {
          const i = chooseOption(f.options, value, key, kindOfKey);
          if (i >= 0) { setValue(el, el.options[i].value); ok = true; }
        } else if (f.kind === "radio") {
          const i = chooseOption(f.options, value, key, kindOfKey);
          if (i >= 0) { const r = f.group[i]; if (!r.checked) r.click(); ok = true; }
        } else if (f.kind === "checkbox") {
          const want = value === true || /^(yes|true)$/i.test(String(value));
          if (el.checked !== want) el.click();
          ok = true;
        } else if (f.kind === "combobox") {
          ok = await fillCombobox(el, typeof value === "boolean" ? (value ? "Yes" : "No") : value);
          if (!ok) state = "review", (ok = !!el.value);
        } else if (f.kind === "customselect") {
          ok = await fillCustomSelect(el, value, key, kindOfKey);
        } else if (f.kind === "ariaradio") {
          const i = chooseOption(f.options, value, key, kindOfKey);
          if (i >= 0) { realClick(f.group[i]); ok = true; }
        } else if (f.kind === "chips") {
          // Chat chips send the answer the moment they're clicked, so we only point at our suggestion.
          const i = chooseOption(f.options, value, key, kindOfKey);
          if (i >= 0) {
            const chip = f.group[i];
            chip.style.outline = `3px solid ${COLORS.review}`;
            chip.style.outlineOffset = "2px";
            chip.dataset.amState = "review";
            chip.title = "ApplyMate suggests this answer: click it to send";
            summary.suggested = (summary.suggested || 0) + 1;
            continue;
          }
        } else {
          setValue(el, typeof value === "boolean" ? (value ? "Yes" : "No") : value);
          ok = true;
        }
      } catch (e) {
        ok = false;
      }
      if (ok) {
        window.__AM_filled.add(el);
        if (f.group) f.group.forEach((g) => window.__AM_filled.add(g));
        mark(el, state);
        summary.filled++;
        if (state === "review") summary.review++;
      } else if (f.required) {
        mark(el, "missing");
        summary.missing.push(f.question || el.name);
      } else {
        mark(el, "review");
        summary.review++;
      }
    }
    window.__AM_lastFill = { at: Date.now(), opts };
    if (summary.filled) chrome.runtime.sendMessage({ type: "filled", summary }).catch(() => {});
    return summary;
  };

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

  window.__AM_test = { matchKey, chooseOption, valueFor };
})();
