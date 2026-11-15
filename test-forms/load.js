/* Test-only: loads the shim + ApplyMate content scripts in order, like Chrome does. */
(function () {
  const files = ["/test-forms/shim.js", "/lib/common.js", "/content/detect.js", "/content/fill.js", "/content/learn.js", "/content/ui.js"];
  let i = 0;
  (function next() {
    if (i >= files.length) { window.__AM_ready = true; return; }
    const s = document.createElement("script");
    s.src = files[i++] + "?v=" + Date.now(); // avoid stale cached scripts while testing
    s.onload = next;
    document.head.appendChild(s);
  })();
})();

/** seed a realistic profile + a tiny PDF "resume" + one saved answer */
window.__seed = async function () {
  const pdf = "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbXS9Db3VudCAwPj5lbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+PgolJUVPRg==";
  await chrome.storage.local.set({
    profile: {
      ...AM.EMPTY_PROFILE, firstName: "Asha", lastName: "Verma", email: "asha.test@example.com", phone: "+91 98765 43210", city: "Bengaluru",
      preferredLocations: "Bengaluru, Pune", linkedin: "https://www.linkedin.com/in/asha-test", github: "https://github.com/asha-test", portfolio: "https://asha.dev",
      currentCompany: "Acme Tech", currentTitle: "Frontend Developer", totalExperience: "3.5", currentCTC: "12", expectedCTC: "18", noticePeriod: "30",
      degree: "B.Tech Computer Science", college: "NIT Trichy", gradYear: "2021", cgpa: "8.4", skills: "React, TypeScript, JavaScript, Node.js, Redux, CSS, Jest, AWS",
      summary: "Frontend developer with 3.5 years building React apps.", defaultResumeId: "r1",
      experience: [{ company: "Acme Tech", title: "Frontend Developer", start: "Jul 2021", end: "Present", bullets: ["Built a React + TypeScript design system used by 6 teams", "Cut page load time by 40% with code splitting", "Wrote Jest tests raising coverage to 80%"] }],
    },
    "file:r1": { name: "Asha_Verma_Resume.pdf", type: "application/pdf", data: pdf },
    files: [{ id: "r1", name: "Asha_Verma_Resume.pdf", kind: "resume" }],
    answers: [{ id: "a1", q: "Why do you want to leave your current job?", a: "Looking for larger product ownership and to grow at {company}.", updatedAt: "2026-11-01" }],
    settings: { ...AM.DEFAULT_SETTINGS, prefs: { ...AM.DEFAULT_SETTINGS.prefs, roles: "Frontend Developer, React Developer", locations: "Bengaluru, Remote" } },
  });
};
