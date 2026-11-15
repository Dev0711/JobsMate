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
   - Skills the job asks for that aren't on your resume each get a **+ Add** button, which puts them in your resume's Skills section. Add only what you've really used.
   - Suggestions are real technical skills only, never page words like "remote" or "posted".
3. **Tailor.** Under **Tailor resume**, use **Quick tailor** (offline) or **✨ Copy AI prompt**:
   - The prompt (your profile, the job and strict "no invented facts" rules) is copied, and your AI chat opens in a new tab.
   - Paste it there (Ctrl+V), copy the whole reply, and paste it into the box at the top of the panel.
   - ApplyMate shows each change for you to approve, then builds a job-specific PDF or DOCX.
   - **Cover letter**, **screening answers**, **interview questions** and **referral messages** work the same way.
4. **Apply.** Click **Fill form**, the floating **Fill** button, or press `Alt+Shift+F`.
   - Green: filled.
   - Amber: please check (usually reused answers).
   - Red: required and left for you.
   - Works inside iframes too (company sites that embed Greenhouse or Lever).
   - Every field is attempted, required and optional. Questions your profile doesn't cover are worked out where possible:
     - "Do you have experience with Kafka?" → Yes or No from your skills.
     - "Years with React?" → your experience.
     - "Can you join in 30 days?" → your notice period.
     - "Which of these technologies…" → ticks the ones you know.
   - Anything left is marked **red** (required) or **blue dashed** (optional) and listed in the panel.
   - **✨ Answer the rest with AI** sends all of those questions in one prompt. The answers you paste back are filled in and saved, so next time they fill automatically.
   - Dropdowns of every common kind:
     - normal dropdowns, radio buttons and checkboxes;
     - Workday and MUI-style button dropdowns, using the popup's search box for long lists like Country;
     - type-to-search location and skill pickers;
     - ARIA radio groups;
     - plain div dropdowns with no ARIA at all;
     - Yes/No button rows;
     - multi-select checkboxes;
     - custom switches;
     - skill tag pickers;
     - DD/MM/YYYY dates.
   - Naukri-style chatbot questions: ApplyMate **outlines** the suggested answer chip, and you click it, because a chip sends the answer immediately.
5. **Teach it.** Answers you type are saved to the **Answers** bank and reused next time. Right-click a field and choose **ApplyMate: this field is…** to fix a mapping on that site for good.
6. **Track.**
   - After you submit a form ApplyMate filled, it asks whether to mark the job as applied.
   - One-click applies on Naukri and LinkedIn Easy Apply are logged automatically, with Undo.
   - Follow-up reminders default to 7 days, and the toolbar badge shows how many are overdue.
7. **Referrals.**
   - **Referrals & HR** opens LinkedIn searches for recruiters, engineers, alumni from your college and ex-colleagues at that company.
   - On a LinkedIn profile, right-click and choose **ApplyMate: save this person**.
   - Draft a connection note, referral request or HR note, send it yourself, then press **I sent it** to get a 5-day follow-up reminder.
8. **Recruiter called?** Go to **Tracker** and use **+ Recruiter call**. Add interview rounds to get reminders 24 hours before each one, and keep prep notes per application.

## Notes and limits
- Site layouts change. If a site stops filling well, the generic engine plus right-click mapping usually covers it. Workday's multi-step forms are best-effort, one page at a time.
- Consent, terms and privacy checkboxes are never ticked, and password, OTP, bank and ID fields are never touched.
- Your data lives only in this Chrome profile, and uninstalling deletes it. Use **Settings → Export backup** regularly.
- AI help never sends anything by itself: the prompt goes only through your clipboard, and nothing is put in a URL. The prompt includes your profile (name, experience, skills, and for screening answers your CTC and notice period), so paste it only into a chat you trust.
- If your Chrome has its built-in on-device AI (Gemini Nano), ApplyMate uses it automatically for short factual answers and key-requirement extraction. Settings shows whether it's available; on most laptops it isn't, and that's fine.

## Development
- No build step. The vendored libraries in `lib/vendor/` are pdf.js 4.10.38, plus one bundle of jsPDF 2.5.2 and docx 9.0.3.
- `test-forms/` has local test pages (Greenhouse-like, React-controlled, an iframe on a company page, custom dropdowns / chatbot chips, mixed screening questions) and `panel.html`, a harness that runs the side panel next to a test page. To use them, serve the folder with `python -m http.server 8765` and open `http://localhost:8765/test-forms/panel.html`. You can delete this folder; the extension doesn't use it.
