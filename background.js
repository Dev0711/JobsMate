/* ApplyMate service worker: menus, reminders, badge, message routing. */
importScripts("lib/common.js");

const MAP_KEYS = [
  "fullName", "firstName", "lastName", "email", "phone", "city", "linkedin", "github", "portfolio",
  "currentCompany", "currentTitle", "totalExperience", "currentCTC", "expectedCTC", "noticePeriod",
  "college", "degree", "gradYear", "skills", "summary", "coverLetter",
];

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "saveJob", title: "ApplyMate: save this job to tracker", contexts: ["page", "selection"] });
    chrome.contextMenus.create({ id: "saveContact", title: "ApplyMate: save this person as a referral contact", contexts: ["page"], documentUrlPatterns: ["https://www.linkedin.com/in/*"] });
    chrome.contextMenus.create({ id: "fill", title: "ApplyMate: fill this form", contexts: ["page", "editable"] });
    chrome.contextMenus.create({ id: "map", title: "ApplyMate: this field is…", contexts: ["editable"] });
    for (const k of MAP_KEYS) chrome.contextMenus.create({ id: "map:" + k, parentId: "map", title: AM.FIELD_MAP[k].label, contexts: ["editable"] });
    chrome.contextMenus.create({ id: "map:skip", parentId: "map", title: "Never fill this field on this site", contexts: ["editable"] });
  });
  chrome.alarms.create("tick", { periodInMinutes: 30, delayInMinutes: 1 });
  const s = await AM.get("settings", null);
  if (!s) await AM.set("settings", AM.DEFAULT_SETTINGS);
  refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get("tick", (a) => a || chrome.alarms.create("tick", { periodInMinutes: 30, delayInMinutes: 1 }));
  refreshBadge();
});

async function tabJob(tabId) {
  const r = await chrome.storage.session.get("tabjob:" + tabId);
  return r["tabjob:" + tabId] || null;
}

async function logApp({ job, status, note }, tabId) {
  const apps = await AM.getApps();
  const before = apps.find((a) => a.jobKey === AM.jobKey(job.url));
  const app = await AM.upsertApp({
    url: job.url, company: job.company, role: job.title, location: job.location,
    jd: (job.description || "").slice(0, 8000), status, statusNote: note || "",
  });
  if (status === "Saved" && /company site/i.test(note || "")) await chrome.storage.session.set({ pendingExternal: { id: app.id, at: Date.now(), title: app.role, company: app.company, url: app.url } });
  if (status === "Applied") {
    const pe = (await chrome.storage.session.get("pendingExternal")).pendingExternal;
    if (pe && pe.id !== app.id && Date.now() - pe.at < 3 * 3600e3 && AM.norm(pe.company) === AM.norm(app.company)) {
      // The company-site application belongs to the portal posting saved earlier: merge into that one.
      await AM.upsertApp({ id: pe.id, status: "Applied", statusNote: "Applied on company site " + AM.portal(job.url) });
      const all = await AM.getApps();
      if (!before) await AM.set("apps", all.filter((a) => a.id !== app.id));
      await chrome.storage.session.remove("pendingExternal");
    }
  }
  if (tabId) await chrome.storage.session.set({ ["tabjob:" + tabId]: { ...job, status } });
  refreshBadge();
  return { id: app.id, created: !before, prevStatus: before ? before.status : null, followUp: app.followUp };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  (async () => {
    switch (msg.type) {
      case "getFillOptions": {
        const r = await chrome.storage.session.get("fill:" + tabId);
        return r["fill:" + tabId] || {};
      }
      case "jobSeen":
        if (tabId) await chrome.storage.session.set({ ["tabjob:" + tabId]: msg.job });
        return true;
      case "getTabJob": {
        const j = await tabJob(tabId);
        if (j) return j;
        const pe = (await chrome.storage.session.get("pendingExternal")).pendingExternal;
        return pe && Date.now() - pe.at < 3 * 3600e3 ? { title: pe.title, company: pe.company, url: pe.url } : null;
      }
      case "maybeApplied": {
        let job = await tabJob(tabId);
        if (!job) {
          const pe = (await chrome.storage.session.get("pendingExternal")).pendingExternal;
          if (pe) job = { title: pe.title, company: pe.company, url: pe.url };
        }
        chrome.tabs.sendMessage(tabId, { type: "askApplied", job }, { frameId: 0 }).catch(() => {});
        return true;
      }
      case "logApp":
        return logApp(msg, tabId);
      case "undoLog": {
        const apps = await AM.getApps();
        if (msg.created) await AM.set("apps", apps.filter((a) => a.id !== msg.id));
        else {
          const a = apps.find((x) => x.id === msg.id);
          if (a) { a.status = msg.prevStatus; a.timeline.push({ at: new Date().toISOString(), status: msg.prevStatus, note: "Undo" }); await AM.set("apps", apps); }
        }
        refreshBadge();
        return true;
      }
      case "filled":
        return true;
      case "refreshBadge":
        refreshBadge();
        return true;
    }
  })().then(reply, (e) => reply({ error: String(e) }));
  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "fill") {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.__AM_runFill && document.querySelector("input,textarea,select") && window.__AM_runFill() }).catch(() => {});
  } else if (String(info.menuItemId).startsWith("map:")) {
    chrome.tabs.sendMessage(tab.id, { type: "mapField", key: info.menuItemId.slice(4) }, { frameId: info.frameId || 0 }).catch(() => {});
  } else if (info.menuItemId === "saveJob") {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__AM_detect.getJobInfo() });
    const job = res && res.result;
    if (!job) return;
    if (info.selectionText && info.selectionText.length > 200) job.description = info.selectionText;
    await logApp({ job, status: "Saved" }, tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "toast", text: `Saved: ${job.title} · ${job.company}` }, { frameId: 0 }).catch(() => {});
  } else if (info.menuItemId === "saveContact") {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__AM_detect.getLinkedInProfile() });
    const p = res && res.result;
    if (!p) return;
    const contacts = await AM.get("contacts", []);
    if (!contacts.find((c) => c.url === p.url)) {
      contacts.unshift({ id: AM.uid(), ...p, relationship: "Cold", status: "Not contacted", channel: "LinkedIn", createdAt: AM.today() });
      await AM.set("contacts", contacts);
    }
    chrome.tabs.sendMessage(tab.id, { type: "toast", text: `Saved contact: ${p.name}${p.company ? " (" + p.company + ")" : ""}` }, { frameId: 0 }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "fill-form") return;
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab) chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.__AM_runFill && document.querySelector("input,textarea,select") && window.__AM_runFill() }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(["tabjob:" + tabId, "fill:" + tabId]));

// ---------- reminders ----------
async function refreshBadge() {
  const apps = await AM.getApps();
  const contacts = await AM.get("contacts", []);
  const n = apps.filter(AM.isOverdue).length + contacts.filter((c) => c.followUp && c.followUp <= AM.today() && ["Request sent", "Not contacted"].includes(c.status)).length;
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
}

function notify(id, title, message) {
  chrome.notifications.create(id, { type: "basic", iconUrl: "icons/128.png", title, message, priority: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tick") return;
  const today = AM.today();
  const settings = await AM.getSettings();
  const notified = await AM.get("notified", {});
  const once = (key) => (notified[key] ? false : (notified[key] = true));

  const apps = await AM.getApps();
  const due = apps.filter(AM.isOverdue);
  if (due.length && once("followups:" + today))
    notify("followups", `${due.length} follow-up${due.length > 1 ? "s" : ""} due`, due.slice(0, 3).map((a) => `${a.company}: ${a.role}`).join("\n"));

  const contacts = await AM.get("contacts", []);
  const cdue = contacts.filter((c) => c.followUp && c.followUp <= today && c.status === "Request sent");
  if (cdue.length && once("contacts:" + today)) notify("contacts", "Referral follow-ups due", cdue.slice(0, 3).map((c) => `${c.name} (${c.company})`).join("\n"));

  // interview rounds in the next 24h
  const now = Date.now();
  for (const a of apps) for (const r of a.rounds || []) {
    if (!r.at) continue;
    const t = new Date(r.at).getTime();
    if (t > now && t - now < 24 * 3600e3 && once("round:" + r.id)) notify("round:" + r.id, `Interview: ${a.company}`, `${r.name || "Round"} at ${new Date(r.at).toLocaleString()}`);
  }

  if (settings.naukriRefreshDays > 0 && (!settings.naukriLastRefresh || AM.addDays(settings.naukriLastRefresh, settings.naukriRefreshDays) <= today) && once("naukri:" + today))
    notify("naukri", "Refresh your Naukri profile", "Updating your profile regularly keeps you visible in recruiter searches. Click to open it.");

  if (settings.searchReminder && settings.lastSearchReminder !== today && new Date().getHours() >= settings.searchReminderHour && once("search:" + today)) {
    notify("search", "Today's job searches", "New jobs from the last 24h are waiting. Click to open your saved searches.");
    await AM.saveSettings({ lastSearchReminder: today });
  }
  // keep the notified log small
  for (const k of Object.keys(notified)) if (/\d{4}-\d{2}-\d{2}$/.test(k) && !k.endsWith(today)) delete notified[k];
  await AM.set("notified", notified);
  refreshBadge();
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id === "naukri") {
    chrome.tabs.create({ url: "https://www.naukri.com/mnjuser/profile" });
    AM.saveSettings({ naukriLastRefresh: AM.today() });
  } else if (id === "search") {
    const settings = await AM.getSettings();
    const profile = await AM.getProfile();
    const links = AM.searchLinks(settings.prefs, profile).filter((l) => /LinkedIn|Naukri/.test(l.site)).slice(0, 6);
    for (const l of links) chrome.tabs.create({ url: l.url, active: false });
  }
  chrome.notifications.clear(id);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.apps || changes.contacts) refreshBadge();
});
