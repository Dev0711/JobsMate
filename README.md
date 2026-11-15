# ApplyMate: job application helper (Chrome extension)

Fills job application forms, remembers your answers, scores jobs against your resume, tailors your resume and cover letter, and tracks applications, referrals and follow-ups. Everything is stored in your browser. There are no API keys and no costs: AI help works by copying a ready prompt into the AI chat you already use (Claude, ChatGPT or Gemini).

**It never submits, clicks "Next", or crawls job sites for you.** It fills fields on the page you opened; you review and click Submit.

## Install (2 minutes)
1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `applymate` folder.
4. Pin ApplyMate and click its icon (or press `Alt+Shift+A`) to open the side panel.
5. Go to **Profile**, upload your resume PDF and check the fields, especially the India-specific ones: CTC, notice period, relocation.
6. Go to **Settings** and set your target roles and locations, and pick your AI chat (Claude, ChatGPT or Gemini).

## Daily flow
1. **Find jobs.** Click **Today's searches** to open LinkedIn and Naukri searches filtered to the last 24 hours, or browse any careers page.
2. **Judge fit.** Open a posting. The **This job** tab shows a match score, the skills you have, red flags (experience, location, notice period, pay), and the job's key requirements, each marked ✓ or ✗.
   - Skills the job asks for that aren't on your resume each get a **+ Add** button. Add only what you've really used.

### Updating your own resume (Word → PDF)
1. Upload your **Word resume (.docx)** in **Profile → Resume**. ApplyMate finds your skill lines, such as *Frontend / Backend / DevOps*. Lines can be written as "Label: items", as a two-column table, or as a label with the list underneath.
2. **+ Add** on a job queues the skill. **Update my resume** shows the line it proposes ("Next.js → Frontend", "Kubernetes → DevOps") with the reason, and you can pick a different line. Skills already on your resume are skipped.
3. **Preview final PDF** adds the skills to the end of those lines in **your** formatting: same font, size and colour, and the line's own separator (comma, `|`, `•` …). Then it shows you the final PDF.
4. **Use this PDF as my resume** makes it the file attached to applications and keeps the edited Word file as the source for next time. **Download PDF** and **Download Word** are there too. Your original file is never changed.

### Exact PDF with Microsoft Word (recommended, one-time setup)
For a PDF identical to what Word produces, ApplyMate uses **Microsoft Word on your PC** through a small local helper. It works on Windows and needs Word and Python 3.
1. Open the `native` folder and double-click **`install.bat`**.
2. Paste the extension ID shown in **ApplyMate → Settings → Exact PDF with Microsoft Word**.
3. Press **Check** in Settings: it should say *connected ✓*.

The helper runs only when you click Preview. It opens the edited resume in Word read-only and invisibly, saves it as a PDF, and returns it. It never closes a Word window you have open. `uninstall.bat` removes it.

Without the helper, the preview falls back to a quick in-browser rendering. That one is **approximate**: spacing and right-aligned dates can differ from Word. Save it via the print dialog with **Save as PDF**.

## Notes and limits
- Site layouts change. If a site stops filling well, the generic engine plus right-click mapping usually covers it. Workday's multi-step forms are best-effort, one page at a time.
- Consent, terms and privacy checkboxes are never ticked, and password, OTP, bank and ID fields are never touched.
- Your data lives only in this Chrome profile, and uninstalling deletes it. Use **Settings → Export backup** regularly.
- AI help never sends anything by itself: the prompt goes only through your clipboard, and nothing is put in a URL. The prompt includes your profile (name, experience, skills, and for screening answers your CTC and notice period), so paste it only into a chat you trust.
- If your Chrome has its built-in on-device AI (Gemini Nano), ApplyMate uses it automatically for short factual answers and key-requirement extraction. Settings shows whether it's available; on most laptops it isn't, and that's fine.

## Development
- No build step. The vendored libraries in `lib/vendor/` are pdf.js 4.10.38, plus one bundle of jsPDF 2.5.2 and docx 9.0.3, and `docx-tools.js` (docx-preview 0.4.1 + JSZip 3.10.2) for reading, editing and rendering Word files.
- `test-forms/` has local test pages (Greenhouse-like, React-controlled, an iframe on a company page, custom dropdowns / chatbot chips, mixed screening questions), `resumes/` (sample Word resumes), `docx-test.html` and `preview-test.html` (resume editing and PDF tests) and `panel.html`, a harness that runs the side panel next to a test page. To use them, serve the folder with `python -m http.server 8765` and open `http://localhost:8765/test-forms/panel.html`. You can delete this folder; the extension doesn't use it.
