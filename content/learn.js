/* Answer bank learning: remembers answers YOU type into questions ApplyMate couldn't fill. */
(function () {
  if (window.__AM_learn) return;
  window.__AM_learn = true;
  const D = window.__AM_detect;
  const pending = new Map();

  function answerText(f) {
    const el = f.el;
    if (f.kind === "select") return el.selectedIndex > 0 ? el.options[el.selectedIndex].text.trim() : "";
    if (f.kind === "radio") { const i = f.group.findIndex((g) => g.checked); return i >= 0 ? f.options[i] : ""; }
    if (f.kind === "checkgroup") return f.group.map((g, i) => ((g.tagName === "INPUT" ? g.checked : g.getAttribute("aria-checked") === "true") ? f.options[i] : "")).filter(Boolean).join(" | ");
    if (f.kind === "checkbox") return el.checked ? "Yes" : "No";
    if (el.isContentEditable) return el.innerText.trim();
    return String(el.value || "").trim();
  }

  function onUserChange(target) {
      if (!target || !target.matches || !target.matches("input, textarea, select, [contenteditable='true']")) return;
      if (target.type === "file" || target.type === "password") return;
      const f = D.collectFields().find((x) => x.el === target || (x.group && x.group.includes(target)));
      if (!f || !f.question || f.question.length < 4) return;
      const m = window.__AM_test && window.__AM_test.matchKey(f, null);
      if (m && m.score >= 12 && !["coverLetter", "summary"].includes(m.key)) return; // profile data, not a reusable answer
      const a = answerText(f);
      if (!a || a.length > 4000) return;
      pending.set(D.fieldSignature(f), { q: f.question.replace(/\s*\*\s*$/, "").slice(0, 300), a });
  }
  // only real user edits (isTrusted), never our own synthetic events
  document.addEventListener("change", (e) => e.isTrusted && onUserChange(e.composedPath()[0]), true);
  // Rich text boxes often never fire "change" before navigation: capture them after typing pauses.
  const timers = new WeakMap();
  document.addEventListener("input", (e) => {
    if (!e.isTrusted) return;
    const t = e.composedPath()[0];
    if (!t || !t.isContentEditable) return;
    clearTimeout(timers.get(t));
    timers.set(t, setTimeout(() => onUserChange(t), 900));
  }, true);

  window.__AM_saveAnswers = async function () {
    if (!pending.size) return 0;
    const answers = await AM.get("answers", []);
    let n = 0;
    for (const { q, a } of pending.values()) {
      const hit = AM.findAnswer(answers, q, 0.85);
      if (hit) { hit.answer.a = a; hit.answer.updatedAt = AM.today(); }
      else answers.unshift({ id: AM.uid(), q, a, updatedAt: AM.today(), uses: 0 });
      n++;
    }
    pending.clear();
    await AM.set("answers", answers);
    return n;
  };

  // Custom widgets: remember the option you pick in a dropdown popup, ARIA radio or chat chip.
  // Captured on pointerdown, before the widget closes the popup or removes the chips.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.isTrusted) return;
      const t = e.composedPath()[0];
      if (!t || !t.closest) return;
      const opt = t.closest('[role="option"], [role="menuitem"], [role="menuitemradio"]');
      const radio = t.closest('[role="radio"]:not(input)');
      const chip = t.closest('[class*="chip" i]');
      const btn = !opt && !radio && !chip && t.closest('button, [role="button"]');
      if (btn) {
        // Yes/No button rows
        const bf = D.collectFields().find((x) => x.kind === "buttongroup" && x.group.includes(btn));
        if (bf && bf.question && bf.question.length > 3) {
          const m = window.__AM_test && window.__AM_test.matchKey(bf, null);
          if (!(m && m.score >= 12)) pending.set(D.fieldSignature(bf), { q: bf.question.replace(/\s*\*\s*$/, "").slice(0, 300), a: (btn.innerText || "").trim() });
        }
        return;
      }
      if (!opt && !radio && !chip) return;
      const fields = D.collectFields();
      let f = null, a = "";
      if (opt) {
        f = fields.find((x) => x.kind === "customselect" && x.el.getAttribute("aria-expanded") === "true");
        a = (opt.innerText || opt.textContent || "").trim();
      } else {
        const g = radio || chip;
        f = fields.find((x) => (x.kind === "ariaradio" || x.kind === "chips") && x.group.includes(g));
        a = (g.innerText || g.textContent || "").trim();
      }
      if (!f || !f.question || f.question.length < 4 || !a) return;
      const m = window.__AM_test && window.__AM_test.matchKey(f, null);
      if (m && m.score >= 12) return; // profile data, not a reusable answer
      pending.set(D.fieldSignature(f), { q: f.question.replace(/\s*\*\s*$/, "").slice(0, 300), a });
      if (chip) setTimeout(() => window.__AM_saveAnswers().catch(() => {}), 50); // chat moves on immediately
    },
    true
  );

  const flush = () => window.__AM_saveAnswers().catch(() => {});
  document.addEventListener("submit", flush, true);
  document.addEventListener(
    "click",
    (e) => {
      const b = e.composedPath()[0] && e.composedPath()[0].closest && e.composedPath()[0].closest("button, input[type=submit], a[role=button], [role=button]");
      if (b && /submit|apply|send|next|continue|review|save|finish/i.test(b.innerText || b.value || b.getAttribute("aria-label") || "")) flush();
    },
    true
  );
  window.addEventListener("pagehide", flush);
})();
