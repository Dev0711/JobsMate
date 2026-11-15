/* Test-only stand-in for the chrome.* APIs, so content scripts can run on plain local pages.
   Storage is shared across frames through localStorage. Not part of the extension. */
(function () {
  const KEY = "am_test_store";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const area = {
    async get(k) {
      const d = load();
      if (k === null || k === undefined) return d;
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in d).map((x) => [x, d[x]]));
    },
    async set(o) { save({ ...load(), ...o }); },
    async remove(k) { const d = load(); [].concat(k).forEach((x) => delete d[x]); save(d); },
    async clear() { save({}); },
  };
  window.__msgs = [];
  window.chrome = {
    storage: { local: area, session: area, onChanged: { addListener() {} } },
    runtime: {
      sendMessage: async (m) => { window.top.__msgs && window.top.__msgs.push(m); return m.type === "getFillOptions" ? JSON.parse(localStorage.getItem("am_fill_opts") || "{}") : m.type === "logApp" ? { id: "x", created: true, followUp: "soon" } : null; },
      onMessage: { addListener() {} },
      getURL: (p) => "/" + p,
    },
  };
})();
