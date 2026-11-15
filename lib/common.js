/* ApplyMate shared logic. Classic script: loaded by content scripts, the background worker and the side panel.
   Everything hangs off globalThis.AM. No network calls here. */
(function () {
  if (globalThis.AM) return;
  const AM = (globalThis.AM = {});

  // ---------- storage ----------
  AM.get = async (key, fallback) => {
    const r = await chrome.storage.local.get(key);
    return r[key] === undefined ? fallback : r[key];
  };
  AM.set = (key, value) => chrome.storage.local.set({ [key]: value });
  AM.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // local dates (not UTC), so "today" is right in IST after midnight
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  AM.today = () => ymd(new Date());
  AM.addDays = (iso, n) => {
    const d = iso ? new Date(iso + "T00:00:00") : new Date();
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

  AM.DEFAULT_SETTINGS = {
    aiSite: "claude", // where "Copy AI prompt" opens: claude | chatgpt | gemini
    aiOpenSite: true,
    followUpDays: 7,
    naukriRefreshDays: 3,
    naukriLastRefresh: "",
    searchReminder: true,
    searchReminderHour: 9,
    lastSearchReminder: "",
    floatingButton: true,
    autoLogOneClick: true,
    prefs: {
      roles: "",
      locations: "",
      remoteOk: true,
      mustHave: "",
      avoid: "",
      minCTC: "",
      experienceLevel: "",
    },
  };
  AM.getSettings = async () => {
    const s = await AM.get("settings", {});
    return { ...AM.DEFAULT_SETTINGS, ...s, prefs: { ...AM.DEFAULT_SETTINGS.prefs, ...(s.prefs || {}) } };
  };
  AM.saveSettings = async (patch) => {
    const s = await AM.getSettings();
    await AM.set("settings", { ...s, ...patch });
  };

  // ---------- text helpers ----------
  AM.norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^a-z0-9+#./'\s-]/g, " ")
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const STOP = new Set(
    "a an the and or of to in on for with at by from as is are be your you our we this that it will can do does have has what which who how when where please enter select any if not no yes i my me us e g etc want would like kindly mention provide".split(" ")
  );
  // fold common synonyms so "Why are you leaving your job?" ≈ "Reason for changing your role"
  const FOLD = {
    role: "job", position: "job", jobs: "job", opening: "job", organization: "company", organisation: "company", employer: "company", firm: "company",
    leaving: "leave", change: "leave", changing: "leave", switch: "leave", switching: "leave", quit: "leave", reason: "why",
    yrs: "years", year: "years", exp: "experience", salary: "ctc", compensation: "ctc", package: "ctc", joining: "join", start: "join", relocation: "relocate",
  };
  AM.tokens = (s) => AM.norm(s).split(" ").filter((t) => t && !STOP.has(t)).map((t) => FOLD[t] || t);
  AM.similarity = (a, b) => {
    const A = new Set(AM.tokens(a)),
      B = new Set(AM.tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((t) => B.has(t) && inter++);
    return inter / Math.min(A.size, B.size) * 0.6 + (inter / new Set([...A, ...B]).size) * 0.4;
  };
  AM.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  AM.fillTemplate = (tpl, vars) => String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== "" ? vars[k] : m));
  AM.splitList = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

  // ---------- profile field definitions (synonyms used to match form labels) ----------
  // kind: text | bool | number | file | longtext
  AM.FIELDS = [
    { key: "firstName", label: "First name", syn: ["first name", "given name", "fname", "forename", "firstname"], ac: ["given-name"] },
    { key: "middleName", label: "Middle name", syn: ["middle name"], ac: ["additional-name"] },
    { key: "lastName", label: "Last name", syn: ["last name", "surname", "family name", "lname", "lastname"], ac: ["family-name"] },
    { key: "fullName", label: "Full name", syn: ["full name", "your name", "candidate name", "applicant name", "name"], ac: ["name"] },
    { key: "email", label: "Email", syn: ["email", "e mail", "mail id", "email address"], ac: ["email"] },
    { key: "phone", label: "Phone", syn: ["phone", "mobile", "contact number", "contact no", "telephone", "cell", "whatsapp", "phone number", "mobile number"], ac: ["tel", "tel-national"] },
    { key: "phoneCountryCode", label: "Country code", syn: ["country code", "dial code", "isd"], ac: ["tel-country-code"] },
    { key: "city", label: "Current city", syn: ["current location", "current city", "city", "location", "where are you based", "where are you located", "town"], ac: ["address-level2"] },
    { key: "state", label: "State", syn: ["state", "province", "region"], ac: ["address-level1"] },
    { key: "country", label: "Country", syn: ["country", "nationality"], ac: ["country", "country-name"] },
    { key: "pincode", label: "PIN / ZIP", syn: ["pin code", "pincode", "zip", "postal code", "postcode"], ac: ["postal-code"] },
    { key: "address", label: "Address", syn: ["address", "street", "address line"], ac: ["street-address", "address-line1"] },
    { key: "preferredLocations", label: "Preferred locations", syn: ["preferred location", "preferred city", "preferred work location", "location preference"] },
    { key: "linkedin", label: "LinkedIn URL", syn: ["linkedin", "linked in"] },
    { key: "github", label: "GitHub URL", syn: ["github", "git hub"] },
    { key: "portfolio", label: "Portfolio / website", syn: ["portfolio", "website", "personal site", "personal website", "blog", "other website", "website url"], ac: ["url"] },
    { key: "currentCompany", label: "Current company", syn: ["current company", "current employer", "present employer", "company name", "current organization", "current organisation", "employer", "organization", "organisation"], ac: ["organization"] },
    { key: "currentTitle", label: "Current title", syn: ["current title", "current designation", "current job title", "designation", "job title", "current role", "current position", "title"], ac: ["organization-title"] },
    { key: "totalExperience", label: "Total experience (years)", kind: "number", syn: ["total experience", "years of experience", "total years of experience", "work experience", "experience in years", "total work experience", "how many years", "overall experience", "experience"] },
    { key: "relevantExperience", label: "Relevant experience (years)", kind: "number", syn: ["relevant experience", "relevant years"] },
    { key: "currentCTC", label: "Current CTC (LPA)", kind: "number", syn: ["current ctc", "current salary", "current package", "current compensation", "present ctc", "current annual", "current fixed", "ctc"] },
    { key: "expectedCTC", label: "Expected CTC (LPA)", kind: "number", syn: ["expected ctc", "expected salary", "salary expectation", "salary expectations", "desired salary", "expected compensation", "expected package", "desired compensation"] },
    { key: "noticePeriod", label: "Notice period (days)", kind: "number", syn: ["notice period", "how soon can you join", "joining time", "availability to join", "when can you start", "earliest start", "earliest joining", "days to join", "notice"] },
    { key: "lastWorkingDay", label: "Last working day", syn: ["last working day", "lwd", "last day"] },
    { key: "relocate", label: "Willing to relocate", kind: "bool", syn: ["relocate", "relocation", "willing to move", "open to relocation"] },
    { key: "workMode", label: "Work mode preference", syn: ["work mode", "work preference", "remote or", "hybrid", "workplace preference"] },
    { key: "workAuth", label: "Authorized to work", kind: "bool", syn: ["authorized to work", "authorised to work", "work authorization", "legally authorized", "eligible to work", "right to work"] },
    { key: "sponsorship", label: "Needs visa sponsorship", kind: "bool", syn: ["sponsorship", "visa sponsorship", "require sponsorship"] },
    { key: "gender", label: "Gender", syn: ["gender", "sex"] },
    { key: "dob", label: "Date of birth", syn: ["date of birth", "dob", "birth date", "birthday"], ac: ["bday"] },
    { key: "degree", label: "Highest degree", syn: ["degree", "highest qualification", "qualification", "education level", "highest education"] },
    { key: "college", label: "College / university", syn: ["school", "university", "college", "institution", "institute", "school name"] },
    { key: "gradYear", label: "Graduation year", syn: ["graduation year", "year of passing", "passing year", "year of graduation", "graduation date"] },
    { key: "cgpa", label: "CGPA / %", syn: ["cgpa", "gpa", "percentage", "grade", "marks"] },
    { key: "skills", label: "Key skills", syn: ["skills", "key skills", "technical skills", "technologies", "tech stack"] },
    { key: "summary", label: "Summary", kind: "longtext", syn: ["summary", "about you", "about yourself", "tell us about yourself", "professional summary", "introduce yourself", "bio"] },
    { key: "coverLetter", label: "Cover letter", kind: "longtext", syn: ["cover letter", "why do you want to join", "why do you want to work", "why are you interested", "why us", "why this company", "why join", "additional information", "message to the hiring", "anything else", "motivation"] },
    { key: "resume", label: "Resume file", kind: "file", syn: ["resume", "cv", "curriculum", "upload resume", "attach resume"] },
    { key: "coverLetterFile", label: "Cover letter file", kind: "file", syn: ["cover letter"] },
  ];
  AM.FIELD_MAP = Object.fromEntries(AM.FIELDS.map((f) => [f.key, f]));

  AM.EMPTY_PROFILE = {
    firstName: "", middleName: "", lastName: "", email: "", phone: "", phoneCountryCode: "+91",
    city: "", state: "", country: "India", pincode: "", address: "", preferredLocations: "",
    linkedin: "", github: "", portfolio: "", currentCompany: "", currentTitle: "",
    totalExperience: "", relevantExperience: "", currentCTC: "", expectedCTC: "",
    noticePeriod: "", noticeNegotiable: true, lastWorkingDay: "", relocate: true, workMode: "Hybrid",
    workAuth: true, sponsorship: false, gender: "Prefer not to say", dob: "",
    degree: "", college: "", gradYear: "", cgpa: "", skills: "", summary: "",
    experience: [], // {company,title,start,end,bullets:[]}
    education: [], // {degree,school,year,score}
    projects: [], // {name,link,bullets:[]}
    resumeText: "",
    defaultResumeId: "",
  };
  AM.getProfile = async () => ({ ...AM.EMPTY_PROFILE, ...(await AM.get("profile", {})) });

  /** value of a profile key, formatted for a form */
  AM.profileValue = (p, key) => {
    switch (key) {
      case "fullName":
        return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
      case "phone":
        return String(p.phone || "").replace(/^\+?91[\s-]?/, "").replace(/\s+/g, "");
      default:
        return p[key];
    }
  };

  // ---------- skills dictionary (canonical: aliases) ----------
  AM.SKILLS = {
    javascript: ["javascript", "js", "es6", "ecmascript"], typescript: ["typescript", "ts"], react: ["react", "react.js", "reactjs"],
    "react native": ["react native"], nextjs: ["next.js", "nextjs", "next js"], angular: ["angular", "angularjs"], vue: ["vue", "vue.js", "vuejs", "nuxt"],
    svelte: ["svelte"], redux: ["redux", "zustand", "mobx"], html: ["html", "html5"], css: ["css", "css3", "scss", "sass", "less"], tailwind: ["tailwind", "tailwindcss"],
    "node.js": ["node", "node.js", "nodejs"], express: ["express", "express.js", "expressjs"], nestjs: ["nestjs", "nest.js"], python: ["python"], django: ["django"],
    flask: ["flask"], fastapi: ["fastapi"], java: ["java"], spring: ["spring", "spring boot", "springboot"], kotlin: ["kotlin"], go: ["golang", "go lang"],
    rust: ["rust"], "c++": ["c++", "cpp"], "c#": ["c#", ".net", "dotnet", "asp.net"], php: ["php", "laravel"], ruby: ["ruby", "rails", "ruby on rails"],
    swift: ["swift", "ios"], android: ["android"], flutter: ["flutter", "dart"], sql: ["sql"], postgresql: ["postgres", "postgresql"], mysql: ["mysql"],
    mongodb: ["mongodb", "mongo", "mongoose"], redis: ["redis"], elasticsearch: ["elasticsearch", "opensearch"], kafka: ["kafka"], rabbitmq: ["rabbitmq"],
    graphql: ["graphql", "apollo"], rest: ["rest", "restful", "rest api", "rest apis"], grpc: ["grpc"], microservices: ["microservices", "microservice"],
    aws: ["aws", "amazon web services", "ec2", "s3", "lambda"], gcp: ["gcp", "google cloud"], azure: ["azure"], docker: ["docker", "containers"],
    kubernetes: ["kubernetes", "k8s", "eks", "gke"], terraform: ["terraform"], "ci/cd": ["ci/cd", "cicd", "jenkins", "github actions", "gitlab ci"],
    linux: ["linux", "unix", "bash", "shell scripting"], git: ["git", "github", "gitlab", "bitbucket"], jest: ["jest", "vitest", "mocha"],
    testing: ["unit testing", "testing", "tdd", "cypress", "playwright", "selenium"], webpack: ["webpack", "vite", "babel"],
    "system design": ["system design", "distributed systems", "scalability"], dsa: ["data structures", "algorithms", "dsa"],
    llm: ["llm", "llms", "large language models", "genai", "generative ai", "gen ai", "rag", "langchain", "openai", "anthropic", "claude", "prompt engineering"],
    "machine learning": ["machine learning", "ml", "deep learning", "pytorch", "tensorflow", "scikit learn"], "data analysis": ["pandas", "numpy", "data analysis"],
    figma: ["figma"], agile: ["agile", "scrum", "jira"], "web performance": ["web performance", "core web vitals", "lighthouse"], accessibility: ["accessibility", "a11y", "wcag"],
    firebase: ["firebase", "supabase"], websockets: ["websocket", "websockets", "socket.io"], oauth: ["oauth", "oauth2", "jwt", "sso", "saml"],
    jquery: ["jquery"], bootstrap: ["bootstrap"], "material ui": ["material ui", "material-ui", "mui"], "styled components": ["styled components", "styled-components", "emotion"],
    rxjs: ["rxjs", "ngrx"], storybook: ["storybook"], "micro frontends": ["micro frontends", "micro-frontends", "microfrontends", "module federation"],
    ssr: ["ssr", "server side rendering", "server-side rendering"], pwa: ["pwa", "progressive web app"], seo: ["seo"], "responsive design": ["responsive design", "responsive web design", "cross-browser", "cross browser"],
    d3: ["d3", "d3.js", "chart.js", "highcharts", "recharts"], "three.js": ["three.js", "threejs", "webgl"], electron: ["electron"],
    nosql: ["nosql", "dynamodb", "cassandra", "couchdb"], oracle: ["oracle", "pl/sql", "plsql"], "sql server": ["sql server", "mssql", "t-sql"],
    spark: ["spark", "pyspark", "hadoop"], airflow: ["airflow"], etl: ["etl", "data pipelines", "data pipeline"], snowflake: ["snowflake", "bigquery", "redshift", "databricks"],
    "power bi": ["power bi", "tableau", "looker"], excel: ["excel", "vba"], serverless: ["serverless", "api gateway", "sqs", "sns", "cloudfront"],
    nginx: ["nginx", "apache", "load balancing", "load balancer", "cdn"], ansible: ["ansible", "helm", "argo cd", "argocd", "puppet", "chef"],
    observability: ["observability", "prometheus", "grafana", "datadog", "new relic", "sentry", "elk", "splunk", "monitoring"],
    security: ["owasp", "application security", "penetration testing", "encryption", "iam"], postman: ["postman", "swagger", "openapi"],
    "api design": ["api design", "rest api design", "graphql schema"], "design patterns": ["design patterns", "solid principles", "oop", "object oriented"],
    "unit testing": ["unit tests", "integration testing", "e2e testing", "end to end testing", "bdd"], "performance testing": ["jmeter", "k6", "load testing", "performance testing"],
    appium: ["appium", "espresso", "xcuitest"], selenium: ["selenium", "webdriver"], scala: ["scala"], r: ["r programming", "rstudio"], matlab: ["matlab"],
    c: ["c programming", "embedded c"], "computer vision": ["computer vision", "opencv", "image processing"], nlp: ["nlp", "natural language processing", "spacy", "nltk", "hugging face", "huggingface", "transformers"],
    "vector database": ["vector database", "vector db", "pinecone", "weaviate", "qdrant", "chroma", "faiss", "pgvector", "embeddings"], mlops: ["mlops", "kubeflow", "mlflow", "sagemaker", "vertex ai"],
    blockchain: ["blockchain", "solidity", "web3", "ethereum", "smart contracts"], salesforce: ["salesforce", "apex", "lwc"], sap: ["sap", "abap"], servicenow: ["servicenow"],
    "event driven": ["event driven", "event-driven", "pub/sub", "message queue", "message queues"], caching: ["caching", "memcached", "cache"], "web security": ["xss", "csrf", "cors", "csp"],
    "state management": ["state management", "context api", "react query", "tanstack query", "swr"], "react hooks": ["react hooks", "hooks"], i18n: ["i18n", "internationalization", "localization"],
  };
  const SKILL_LABELS = { javascript: "JavaScript", typescript: "TypeScript", react: "React", "react native": "React Native", nextjs: "Next.js", vue: "Vue.js", "node.js": "Node.js", nestjs: "NestJS", fastapi: "FastAPI", "c++": "C++", "c#": "C# / .NET", php: "PHP", sql: "SQL", postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", graphql: "GraphQL", rest: "REST APIs", grpc: "gRPC", aws: "AWS", gcp: "GCP", "ci/cd": "CI/CD", dsa: "DSA", llm: "LLMs / GenAI", html: "HTML", css: "CSS", "material ui": "Material UI", rxjs: "RxJS", ssr: "SSR", pwa: "PWA", seo: "SEO", d3: "D3.js", "three.js": "Three.js", nosql: "NoSQL", "sql server": "SQL Server", etl: "ETL", "power bi": "Power BI", nlp: "NLP", mlops: "MLOps", sap: "SAP", oauth: "OAuth / JWT", i18n: "i18n", jquery: "jQuery", "api design": "API design", "web security": "Web security" };
  AM.skillLabel = (canon) => SKILL_LABELS[canon] || String(canon).replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const aliasIndex = [];
  for (const [canon, aliases] of Object.entries(AM.SKILLS)) for (const a of aliases) aliasIndex.push([a, canon]);
  aliasIndex.sort((x, y) => y[0].length - x[0].length);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const aliasRe = aliasIndex.map(([a, c]) => [new RegExp("(^|[^a-z0-9+#])" + reEsc(a) + "(?![a-z0-9+#])", "i"), c, a]);
  /** canonical skills mentioned in a text */
  AM.findSkills = (text) => {
    const t = " " + String(text || "").toLowerCase() + " ";
    const out = new Set();
    for (const [re, canon, alias] of aliasRe) {
      if (alias === "go" || alias === "ts" || alias === "js" || alias === "ml") continue; // too ambiguous alone
      if (re.test(t)) out.add(canon);
    }
    if (/\bgolang\b|\bgo developer\b|\bin go\b/i.test(t)) out.add("go");
    return [...out];
  };
  AM.canonSkill = (s) => {
    const n = String(s).toLowerCase().trim();
    for (const [a, c] of aliasIndex) if (a === n) return c;
    return n;
  };

  // ---------- matching ----------
  AM.parseExpRange = (text) => {
    const t = String(text || "").toLowerCase();
    const m = t.match(/(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs|year)/) || t.match(/(\d{1,2})\s*\+?\s*(?:years|yrs|year)/);
    if (!m) return null;
    const min = +m[1];
    const max = m[2] ? +m[2] : min + 4;
    return min <= 30 ? { min, max } : null;
  };
  /** Skills the JD asks for that aren't in your resume or skills list (technical skills only, never page words). */
  AM.atsKeywords = (jdText, resumeText) => {
    const mine = new Set([...AM.findSkills(resumeText), ...AM.splitList(resumeText).map(AM.canonSkill)]);
    return AM.findSkills(jdText).filter((s) => !mine.has(s));
  };
  /** The JD's actual requirement lines (skills / years), each with what you match. */
  AM.jdHighlights = (jdText, profile) => {
    const mine = new Set([...AM.splitList(profile.skills).map(AM.canonSkill), ...AM.findSkills(profile.resumeText)]);
    const seen = new Set();
    const out = [];
    for (let line of String(jdText || "").split(/\n|(?<=[.;])\s+(?=[A-Z])/)) {
      line = line.replace(/^[\s•●▪◦\-*–·]+/, "").replace(/^\d{1,2}[.)]\s+/, "").trim();
      if (line.length < 18 || line.length > 240) continue;
      const skills = AM.findSkills(line);
      const yrs = /\d+\s*\+?\s*(?:-|to)?\s*\d*\s*(years|yrs)/i.test(line);
      if (!skills.length && !yrs) continue;
      const k = AM.norm(line);
      if (seen.has(k)) continue;
      seen.add(k);
      let have = skills.filter((x) => mine.has(x)), missing = skills.filter((x) => !mine.has(x));
      // "Jest or Cypress", "React/Vue/Angular": one of the alternatives is enough
      const alt = /\b(or|any of|one of|either)\b|\w\s*\/\s*\w/i.test(line);
      if (alt && have.length) missing = [];
      // "Bonus:", "nice to have", "a plus": not a hard requirement
      if (/bonus|nice to have|good to have|a plus|preferred|added advantage/i.test(line)) missing = [];
      out.push({ text: line, have, missing });
      if (out.length >= 8) break;
    }
    return out;
  };

  /** keyword fit score of a job against profile + prefs */
  AM.scoreJob = (profile, job, prefs) => {
    prefs = prefs || {};
    const jdText = [job.title, job.description].join("\n");
    const jdSkills = AM.findSkills(jdText);
    const mySkills = new Set([...AM.splitList(profile.skills).map(AM.canonSkill), ...AM.findSkills(profile.resumeText)]);
    const matched = jdSkills.filter((s) => mySkills.has(s));
    const missing = jdSkills.filter((s) => !mySkills.has(s));
    const skillPart = jdSkills.length ? matched.length / jdSkills.length : 0.5;

    const flags = [];
    const exp = parseFloat(profile.totalExperience);
    const range = AM.parseExpRange(job.description);
    let expPart = 0.6;
    if (range && !isNaN(exp)) {
      if (exp >= range.min - 0.5 && exp <= range.max + 2) expPart = 1;
      else if (exp < range.min) { expPart = Math.max(0, 1 - (range.min - exp) / 3); flags.push(`Asks ${range.min}–${range.max} yrs; you have ${exp}`); }
      else { expPart = 0.6; flags.push(`Possibly junior for you (${range.min}–${range.max} yrs)`); }
    }

    const locs = AM.splitList(prefs.locations || profile.preferredLocations || profile.city).map((l) => l.toLowerCase());
    const jobLoc = String(job.location || "").toLowerCase() + " " + String(job.description || "").slice(0, 600).toLowerCase();
    let locPart = 0.5;
    if (/remote|work from home|wfh/.test(jobLoc) && prefs.remoteOk !== false) locPart = 1;
    else if (locs.length && locs.some((l) => jobLoc.includes(l))) locPart = 1;
    else if (locs.length && job.location) { locPart = 0.2; flags.push(`Location: ${job.location}`); }

    const roles = AM.splitList(prefs.roles);
    let titlePart = 0.5;
    if (roles.length && job.title) titlePart = Math.max(...roles.map((r) => AM.similarity(r, job.title)));

    const must = AM.splitList(prefs.mustHave);
    const mustHits = must.filter((k) => jdText.toLowerCase().includes(k.toLowerCase()));
    const avoid = AM.splitList(prefs.avoid);
    const avoidHits = avoid.filter((k) => jdText.toLowerCase().includes(k.toLowerCase()));
    if (avoidHits.length) flags.push("Contains avoided: " + avoidHits.join(", "));
    if (must.length && mustHits.length < must.length) flags.push("Missing must-have: " + must.filter((k) => !mustHits.includes(k)).join(", "));

    const notice = parseInt(profile.noticePeriod, 10);
    if (/immediate(ly)? join|immediate joiner|join immediately|within 15 days|15 days notice|serving notice/i.test(jdText) && notice > 30)
      flags.push(`Wants early joiners; your notice is ${notice} days`);

    const ctcMatch = String(job.salary || jdText).match(/(\d{1,3}(?:\.\d)?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d)?)\s*(?:lpa|lakhs?|lac)/i);
    const minCTC = parseFloat(prefs.minCTC);
    if (ctcMatch && !isNaN(minCTC) && parseFloat(ctcMatch[2]) < minCTC) flags.push(`Pay ${ctcMatch[1]}–${ctcMatch[2]} LPA is below your minimum ${minCTC}`);

    let score = 55 * skillPart + 15 * expPart + 10 * locPart + 15 * titlePart + 5 * (must.length ? mustHits.length / must.length : 0.6);
    score = Math.round(Math.max(0, Math.min(100, score)));
    let label = score >= 68 ? "Good fit" : score >= 45 ? "Stretch" : "Skip";
    if (avoidHits.length) label = "Skip";
    return { score, label, matched, missing, flags, highlights: AM.jdHighlights(job.description, profile) };
  };

  // ---------- rule-based answers for any application question ----------
  /** Work out an answer to a form question from the profile alone. Returns {value, why} or null when the
   *  profile doesn't say (then the user, or the AI step, decides). Never invents facts. */
  AM.ruleAnswer = (question, options, profile, kind) => {
    const q = String(question || "").toLowerCase();
    if (!q.trim()) return null;
    const opts = (options || []).filter(Boolean);
    const mine = new Set([...AM.splitList(profile.skills).map(AM.canonSkill), ...AM.findSkills(profile.resumeText)]);
    const qSkills = AM.findSkills(question);
    const total = parseFloat(profile.totalExperience);
    const relevant = parseFloat(profile.relevantExperience);
    const notice = parseInt(profile.noticePeriod, 10);
    const yesNoQ = /^(do|does|did|are|is|have|has|can|could|will|would|were|was)\b/.test(q.trim()) || opts.some((o) => /^\s*(yes|no)\b/i.test(o)) || ["checkbox", "ariacheck"].includes(kind);
    const yn = (b, why) => (b === null || b === undefined ? null : { value: !!b, why });

    // multi-select of technologies: tick the ones you know
    if ((kind === "checkgroup" || /select all|check all|which of (these|the following)/.test(q)) && opts.length) {
      // strict: the option itself must be one of your skills (Mocha ≠ Jest even though they're related)
      const listed = AM.splitList(profile.skills).map((s) => AM.norm(s));
      const resume = " " + AM.norm(profile.resumeText) + " ";
      const known = opts.filter((o) => { const n = AM.norm(o); return n && (listed.includes(n) || listed.some((l) => l.replace(/\.js$/, "") === n.replace(/\.js$/, "")) || (n.length > 2 && resume.includes(" " + n + " "))); });
      if (known.length) return { value: known, why: "skills in your profile" };
      if (opts.some((o) => AM.findSkills(o).length)) return null;
    }
    // "How many years of experience do you have with React?"
    if (/(how many|number of|total)?\s*(years|yrs)\b|how long/.test(q) && /(experience|exp\b|worked|working|using|hands.?on)/.test(q) && qSkills.length) {
      const has = qSkills.every((s) => mine.has(s));
      const yrs = has ? (isNaN(relevant) ? total : Math.min(relevant, total || relevant)) : 0;
      if (isNaN(yrs)) return null;
      return { value: String(yrs), why: has ? "your experience (skill is in your profile)" : "skill not in your profile" };
    }
    if (yesNoQ) {
      // skills: "Do you have experience with Kafka?", "Are you comfortable with TypeScript?"
      if (qSkills.length && /(experience|knowledge|worked|work with|familiar|comfortable|proficien|hands.?on|exposure|skilled|expert|used|know|knowledge of|good at)/.test(q))
        return yn(qSkills.every((s) => mine.has(s)), "skills in your profile");
      if (/relocat/.test(q)) return yn(profile.relocate, "relocation preference");
      if (/(work from office|wfo|on.?site|onsite|come to (the )?office|in.?office|office \d+ days)/.test(q)) {
        if (profile.workMode === "Remote") return yn(false, "you prefer remote");
        if (["On-site", "Any"].includes(profile.workMode)) return yn(true, "work mode preference");
        return /hybrid|\b[1-3]\s*days?\b/.test(q) ? yn(true, "hybrid preference") : null; // hybrid vs 5 days in office: your call
      }
      if (/hybrid/.test(q)) return yn(["Hybrid", "Any", "On-site"].includes(profile.workMode), "work mode preference");
      if (/remote/.test(q) && /(okay|ok|comfortable|willing|open|fine)/.test(q)) return yn(true, "remote work");
      if (/immediate(ly)?\s*(join|start|available)|join immediately|immediate joiner/.test(q)) return isNaN(notice) ? null : yn(notice <= 15, "notice period");
      let m = q.match(/(join|start|available).{0,25}?(within|in|by)\s*(\d+)\s*(day|week|month)/);
      if (m && !isNaN(notice)) { const lim = +m[3] * (m[4] === "week" ? 7 : m[4] === "month" ? 30 : 1); return yn(notice <= lim, "notice period"); }
      if (/(serving|serve).{0,10}notice/.test(q)) return profile.lastWorkingDay ? yn(true, "last working day set") : null;
      if (/notice.{0,30}(negotiable|buy ?out|reduce|early release)/.test(q)) return yn(profile.noticeNegotiable, "notice negotiable");
      if (/(currently|presently).{0,15}(employed|working)/.test(q)) return yn(!!profile.currentCompany, "current company");
      if (/(master|post.?grad|m\.?tech|mca|m\.?sc|mba)/.test(q) && /(degree|have|completed|hold)/.test(q)) return profile.degree ? yn(/master|m\.?tech|mca|m\.?sc|mba|post/i.test(profile.degree + " " + (profile.education || []).map((e) => e.degree).join(" ")), "your degree") : null;
      if (/(bachelor|graduat|degree|b\.?tech|b\.?e\b|engineering)/.test(q) && /(degree|have|completed|hold|are you)/.test(q)) return profile.degree ? yn(true, "your degree") : null;
      if (/(18|eighteen) (years|yrs)|legal age|above 18|at least 18/.test(q)) {
        if (profile.dob) return yn((Date.now() - new Date(profile.dob)) / 3.156e10 >= 18, "date of birth");
        return total > 0 ? yn(true, "you have work experience") : null;
      }
      if (/(authori[sz]ed|eligible|right) to work|work permit/.test(q)) return yn(profile.workAuth, "work authorization");
      if (/sponsor/.test(q)) return yn(profile.sponsorship, "sponsorship");
      if (/(comfortable|okay|willing).{0,20}(ctc|salary|budget|package|compensation)/.test(q)) return null; // depends on the number: you decide
      return null;
    }
    // numeric experience with no skill named
    if (/(years|yrs).{0,20}(experience)/.test(q) && !isNaN(total)) return { value: String(total), why: "total experience" };
    return null;
  };

  // ---------- tracker ----------
  AM.STATUSES = ["Saved", "Applied", "Screening", "Interview", "Offer", "Rejected", "Ghosted"];
  AM.ACTIVE = new Set(["Applied", "Screening", "Interview"]);
  AM.jobKey = (url) => {
    try {
      const u = new URL(url);
      const keep = ["currentJobId", "jobId", "jid", "gh_jid", "job", "id", "jk", "vjk"];
      const q = keep.filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join("&");
      return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + (q ? "?" + q : "")).toLowerCase();
    } catch {
      return String(url || "");
    }
  };
  AM.portal = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };
  AM.getApps = () => AM.get("apps", []);
  /** create or update an application, matched by jobKey or company+role */
  AM.upsertApp = async (data) => {
    const settings = await AM.getSettings();
    const apps = await AM.getApps();
    const key = data.url ? AM.jobKey(data.url) : "";
    let app =
      (data.id && apps.find((a) => a.id === data.id)) ||
      (key && apps.find((a) => a.jobKey === key)) ||
      (data.company && data.role && apps.find((a) => AM.norm(a.company) === AM.norm(data.company) && AM.norm(a.role) === AM.norm(data.role)));
    const now = new Date().toISOString();
    let prevStatus;
    if (!app) {
      app = { id: AM.uid(), createdAt: now, status: "Saved", timeline: [], rounds: [], notes: "", prep: "", source: "Portal" };
      apps.unshift(app);
      app.timeline.push({ at: now, status: data.status || "Saved", note: data.statusNote || "Added" });
      prevStatus = data.status || "Saved";
      if (data.status === "Applied") {
        app.appliedOn = AM.today();
        if (!data.followUp) app.followUp = AM.addDays(app.appliedOn, settings.followUpDays);
      }
    } else prevStatus = app.status;
    for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== "" && k !== "id") app[k] = v;
    if (key) app.jobKey = key;
    if (data.url) app.portal = AM.portal(data.url);
    if (data.status && data.status !== prevStatus) {
      app.timeline.push({ at: now, status: data.status, note: data.statusNote || "" });
      if (data.status === "Applied") {
        app.appliedOn = app.appliedOn || AM.today();
        if (!data.followUp) app.followUp = AM.addDays(app.appliedOn, settings.followUpDays);
      }
    }
    app.updatedAt = now;
    await AM.set("apps", apps);
    return app;
  };
  AM.isOverdue = (a) => a.followUp && AM.ACTIVE.has(a.status) && a.followUp <= AM.today();

  // ---------- answers bank ----------
  AM.findAnswer = (answers, question, min = 0.62) => {
    let best = null, bestScore = 0;
    for (const a of answers) {
      const s = AM.similarity(a.q, question);
      if (s > bestScore) { best = a; bestScore = s; }
    }
    return bestScore >= min ? { answer: best, score: bestScore } : null;
  };

  // ---------- search URL builders ----------
  const slug = (s) => AM.norm(s).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "-");
  AM.searchLinks = (prefs, profile) => {
    const roles = AM.splitList(prefs.roles);
    const locs = AM.splitList(prefs.locations || profile.preferredLocations || profile.city);
    const exp = parseInt(profile.totalExperience, 10);
    const out = [];
    for (const role of roles.length ? roles : ["software engineer"]) {
      for (const loc of locs.length ? locs : ["India"]) {
        const r = encodeURIComponent(role), l = encodeURIComponent(loc);
        out.push({ site: "LinkedIn (24h)", role, loc, url: `https://www.linkedin.com/jobs/search/?keywords=${r}&location=${l}&f_TPR=r86400&sortBy=DD` });
        out.push({ site: "Naukri (1 day)", role, loc, url: `https://www.naukri.com/${slug(role)}-jobs-in-${slug(loc)}?k=${r}&l=${l}&jobAge=1${isNaN(exp) ? "" : "&experience=" + exp}` });
        out.push({ site: "Indeed India", role, loc, url: `https://in.indeed.com/jobs?q=${r}&l=${l}&fromage=1&sort=date` });
        out.push({ site: "Wellfound", role, loc, url: `https://wellfound.com/role/l/${slug(role)}/${slug(loc)}` });
        out.push({ site: "Google Jobs", role, loc, url: `https://www.google.com/search?q=${encodeURIComponent(role + " jobs in " + loc)}&ibp=htl;jobs` });
        out.push({
          site: "Company ATS (Greenhouse/Lever/Ashby)", role, loc,
          url: `https://www.google.com/search?q=${encodeURIComponent(`(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com) "${role}" (${loc} OR remote)`)}&tbs=qdr:w`,
        });
      }
    }
    return out;
  };
  AM.peopleLinks = (company, profile, role) => {
    const q = (s) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(s)}&origin=GLOBAL_SEARCH_HEADER`;
    const links = [
      { label: "Recruiters / HR", url: q(`${company} talent acquisition recruiter HR`) },
      { label: `Engineers (${role || "your role"})`, url: q(`${company} ${role || profile.currentTitle || "software engineer"}`) },
      { label: "Engineering managers", url: q(`${company} engineering manager`) },
    ];
    const colleges = [profile.college, ...(profile.education || []).map((e) => e.school)].filter(Boolean);
    for (const c of [...new Set(colleges)].slice(0, 2)) links.push({ label: `Alumni: ${c}`, url: q(`${company} ${c}`) });
    const past = [...new Set((profile.experience || []).map((e) => e.company).filter((c) => c && AM.norm(c) !== AM.norm(company)))];
    for (const c of past.slice(0, 2)) links.push({ label: `Ex-colleagues: ${c}`, url: q(`${company} ${c}`) });
    links.push({
      label: "Google: recruiters on LinkedIn",
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${company}" ("recruiter" OR "talent acquisition" OR "HR")`)}`,
    });
    return links;
  };

  // ---------- outreach templates (used when Claude is off) ----------
  AM.OUTREACH = {
    connect: "Hi {first}, I'm a {title} with {exp} yrs in {skills}. I'm applying for the {role} role at {company} and would love to connect and learn about the team.",
    referral:
      "Hi {first},\n\nI hope you're doing well. I came across the {role} opening at {company} ({url}) and I think it's a strong fit:\n\n• {point1}\n• {point2}\n• {point3}\n\nWould you be open to referring me? I'm happy to share my resume and a short note you can forward. Thanks a lot for your time!\n\nBest,\n{me}",
    hr: "Hi {first},\n\nI recently applied for the {role} position at {company}. I have {exp} years of experience in {skills}, and my notice period is {notice} days. I'd love to know if my profile fits, and I'm happy to share anything else you need.\n\nThanks,\n{me}\n{phone}",
    followup: "Hi {first}, just following up on my earlier message about the {role} role at {company}. I'd really appreciate any pointers or a referral if you think I'm a fit. Thanks again!",
  };
  AM.CONTACT_STATUSES = ["Not contacted", "Request sent", "Replied", "Referred", "Declined", "No reply"];
})();
