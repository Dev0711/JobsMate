/* In-page UI: floating Fill button, toasts, applied-detection, one-click apply logging. */
(function () {
  if (window.__AM_ui) return;
  window.__AM_ui = true;
  const D = window.__AM_detect;
  const TOP = window === window.top;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  // ---------- shadow-DOM host so page CSS can't break our UI ----------
  let host, root;
  function ensureRoot() {
    if (root) return root;
    host = document.createElement("applymate-ui");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483646;right:16px;bottom:16px;";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host{all:initial}
      .wrap{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
      .toast{background:#111827;color:#f9fafb;border-radius:10px;padding:10px 12px;max-width:320px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
      .toast b{font-weight:600}
      .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
      button{font:inherit;border:0;border-radius:7px;padding:5px 10px;cursor:pointer;background:#374151;color:#f9fafb}
      button.pri{background:#4f46e5}
      .fab{width:44px;height:44px;border-radius:50%;background:#4f46e5;color:#fff;font-weight:700;font-size:13px;box-shadow:0 4px 16px rgba(79,70,229,.45);padding:0}
      .fab:hover{background:#4338ca}
      .muted{color:#9ca3af;font-size:12px}
    </style><div class="wrap"><div class="toasts"></div></div>`;
    (document.body || document.documentElement).appendChild(host);
    return root;
  }
  function toast(html, buttons = [], ms = 9000) {
    const r = ensureRoot();
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = html;
    if (buttons.length) {
      const row = document.createElement("div");
      row.className = "row";
      for (const b of buttons) {
        const el = document.createElement("button");
        el.textContent = b.label;
        if (b.primary) el.className = "pri";
        el.onclick = async () => { t.remove(); await b.onClick(); };
        row.appendChild(el);
      }
      t.appendChild(row);
    }
    r.querySelector(".toasts").appendChild(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }
  window.__AM_toast = toast;

  // ---------- floating Fill button on application forms ----------
  let fab;
  async function runFill() {
    const opts = (await send({ type: "getFillOptions" })) || {};
    const s = await window.__AM_fill(opts);
    const miss = s.missing.length ? `<div class="muted">Left for you: ${s.missing.slice(0, 4).map(AM.esc).join(", ")}${s.missing.length > 4 ? "…" : ""}</div>` : "";
    toast(`<b>Filled ${s.filled} field${s.filled === 1 ? "" : "s"}</b>${s.review ? ` · ${s.review} to check (amber)` : ""}${s.suggested ? `<div class="muted">Suggested answer highlighted: click it to send.</div>` : ""}${miss}<div class="muted">Review everything, then submit yourself.</div>`, [], 8000);
  }
  window.__AM_runFill = runFill;
  async function maybeShowFab() {
    if (fab) return;
    const settings = await AM.getSettings();
    if (!settings.floatingButton) return;
    if (!D.looksLikeApplicationForm()) return;
    const r = ensureRoot();
    fab = document.createElement("button");
    fab.className = "fab";
    fab.title = "ApplyMate: fill this form (Alt+Shift+F)";
    fab.textContent = "Fill";
    fab.onclick = runFill;
    r.querySelector(".wrap").appendChild(fab);
  }
  let checks = 0;
  const obs = new MutationObserver(() => {
    if (fab || checks > 20) return obs.disconnect();
    clearTimeout(obs.t);
    obs.t = setTimeout(() => { checks++; maybeShowFab(); }, 1200);
  });
  setTimeout(() => { maybeShowFab(); if (document.body) obs.observe(document.body, { childList: true, subtree: true }); }, 800);

  // ---------- logging applications ----------
  async function logApp(status, job, note) {
    job = job || D.getJobInfo();
    const res = await send({ type: "logApp", status, job, note });
    if (!res) return;
    toast(
      status === "Applied"
        ? `<b>Logged as Applied</b><br>${AM.esc(job.title)} · ${AM.esc(job.company)}<div class="muted">Follow-up reminder set for ${AM.esc(res.followUp || "")}</div>`
        : `<b>Saved to tracker</b><br>${AM.esc(job.title)} · ${AM.esc(job.company)}${note ? `<div class="muted">${AM.esc(note)}</div>` : ""}`,
      [{ label: "Undo", onClick: () => send({ type: "undoLog", id: res.id, created: res.created, prevStatus: res.prevStatus }) }]
    );
  }

  const isSubmitLike = (b) => /^(submit|submit application|send application|apply|apply now|finish|complete application)$/i.test((b.innerText || b.value || "").trim()) || (b.type === "submit" && !/next|continue|save|search|sign|log/i.test(b.innerText || b.value || ""));
  // After a form we filled is submitted, ask "Mark as applied?" (in the top frame, where the job info lives).
  function onPossibleSubmit() {
    if (!window.__AM_lastFill || Date.now() - window.__AM_lastFill.at > 60 * 60 * 1000) return;
    window.__AM_lastFill = null;
    send({ type: "maybeApplied" });
  }
  document.addEventListener("submit", onPossibleSubmit, true);
  document.addEventListener(
    "click",
    async (e) => {
      const b = e.composedPath()[0] && e.composedPath()[0].closest && e.composedPath()[0].closest("button, input[type=submit], a, [role=button]");
      if (!b) return;
      const label = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim();
      if (isSubmitLike(b)) onPossibleSubmit();
      if (!TOP) return;
      const settings = await AM.getSettings();
      if (!settings.autoLogOneClick) return;
      const h = location.hostname;
      // One-click applies on portals (no form for us to fill)
      if (/naukri\.com$/.test(h)) {
        if (/^(apply|apply now)$/i.test(label)) setTimeout(() => logApp("Applied", null, "One-click apply on Naukri"), 1200);
        else if (/apply on company (site|website)/i.test(label)) logApp("Saved", null, "Finish on the company site: it'll be marked Applied when you submit there.");
      } else if (/linkedin\.com$/.test(h)) {
        if (/^submit application$/i.test(label)) setTimeout(() => logApp("Applied", null, "LinkedIn Easy Apply"), 800);
        else if (/^apply$/i.test(label) || /on company website/i.test(b.getAttribute("aria-label") || "")) logApp("Saved", null, "Finish on the company site: it'll be marked Applied when you submit there.");
      } else if (/indeed\.com$/.test(h) && /apply on company site/i.test(label)) {
        logApp("Saved", null, "Finish on the company site.");
      }
    },
    true
  );

  if (TOP) {
    // Remember the job this tab is showing, so a later "thank you" page or iframe form can be linked to it.
    const reportJob = () => {
      try {
        const job = D.getJobInfo();
        if (job.looksLikeJob) send({ type: "jobSeen", job: { ...job, description: job.description.slice(0, 8000) } });
      } catch {}
    };
    setTimeout(reportJob, 1500);
    // single-page portals change jobs without a page load
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) { lastHref = location.href; setTimeout(reportJob, 1500); }
    }, 1500);
    // "Thank you for applying" pages
    setTimeout(async () => {
      const t = (document.body && document.body.innerText.slice(0, 6000)) || "";
      if (/thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received|sent)|successfully applied|you('ve| have) applied/i.test(t)) {
        const tabJob = await send({ type: "getTabJob" });
        if (tabJob && tabJob.status !== "Applied")
          toast(`<b>Looks like you applied!</b><br>${AM.esc(tabJob.title)} · ${AM.esc(tabJob.company)}`, [
            { label: "Mark as applied", primary: true, onClick: () => logApp("Applied", tabJob) },
            { label: "Not now", onClick: () => {} },
          ], 20000);
      }
    }, 2000);
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === "askApplied" && TOP) {
      const job = msg.job || D.getJobInfo();
      toast(`<b>Did you submit the application?</b><br>${AM.esc(job.title)} · ${AM.esc(job.company)}`, [
        { label: "Mark as applied", primary: true, onClick: () => logApp("Applied", job) },
        { label: "Not yet", onClick: () => {} },
      ], 30000);
    } else if (msg.type === "runFill") {
      if (D.collectFields().length) runFill();
    } else if (msg.type === "toast" && TOP) {
      toast(AM.esc(msg.text));
    }
  });
})();
