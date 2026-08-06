/* Harmony Verify — assistant knowledge base.
 *
 * Separated from assistant.js so the answers can be edited by anyone who knows
 * the business without touching the widget's plumbing.
 *
 * Each entry is matched by keyword weight rather than a single regex: a question
 * scores against `terms`, and the highest scorer answers. That handles the way
 * people actually ask — "how much", "what's the damage", "is it expensive" all
 * land on pricing without needing one regex to anticipate every phrasing.
 *
 * Every answer here is something the site says elsewhere. The assistant is a
 * faster route to the same facts, not a second source of them — a widget that
 * invents a number a page does not support is worse than no widget.
 */
window.HarmonyKnowledge = {
  /* Questions offered as chips when the panel opens. */
  starters: [
    "How does verification work?",
    "What does it cost?",
    "How fast do I get results?",
    "Who are the reviewers?",
    "How is my data handled?"
  ],

  /* Refused outright. Clinical advice is not this widget's job. */
  clinical:
    /\b(diagnos|prescrib|dosage|dose of|how much .*(mg|ml)\b|my patient|my symptom|should i take|is it safe to take|drug interaction|treatment for my|i have a rash|chest pain)\b/i,

  clinicalReply:
    "I can't answer clinical questions — that's a design decision, not a hedge. Harmony Verify does not practise medicine and does not give medical advice, and an assistant guessing at clinical content would be the exact failure this company exists to catch. For anything clinical, speak to a qualified clinician.",

  fallback:
    'I don\'t have a good answer for that one. I can help with how verification works, pricing, turnaround, reviewers, security and data handling, reports, integration, billing, and applying as an expert or partner. For anything else, <a href="contact.html">the team will pick it up directly</a>.',

  entries: [
    /* --- What it is --------------------------------------------------- */
    {
      id: "what-is-harmony",
      terms: ["what is harmony", "what do you do", "what does harmony do", "explain harmony", "who are you", "what is this"],
      a: "Harmony Verify is an independent verification layer for healthcare AI. You send us output your AI system produced; a licensed clinician in the matching specialty reviews it for accuracy, hallucination, missing information, safety and clinical reasoning; and you get back a signed record you can hand to a governance committee. We don't build clinical AI — we check it."
    },
    {
      id: "how-it-works",
      terms: ["how does it work", "how does verification work", "process", "workflow", "what happens when i submit", "steps", "pipeline"],
      a: "Five steps. <b>1.</b> You submit an AI-generated output. <b>2.</b> It's classified for specialty, complexity and clinical risk. <b>3.</b> It's priced from those three, and you approve before anything starts. <b>4.</b> A matched clinician reviews it against the rubric. <b>5.</b> You're emailed when it's ready and download the signed report from the platform. <a href=\"platform.html\">The platform page walks through it</a>."
    },
    {
      id: "who-is-it-for",
      terms: ["who is this for", "is this for me", "do i need this", "our use case", "we build", "cds", "clinical decision support", "ambient", "scribe"],
      a: "Companies shipping AI that a clinician will act on: clinical decision support, ambient documentation and coding, patient-facing guidance, payer and health-system models. If a wrong output could change a clinical decision, you're the customer. <a href=\"solutions.html\">Solutions breaks it down by product type</a>."
    },
    {
      id: "not-a-model",
      terms: ["do you use ai to check", "is it automated", "is a human involved", "is it a model checking a model", "human in the loop"],
      a: "A model does the triage — classifying specialty, complexity and risk so the case reaches the right person quickly. The judgement is human. A model grading another model reproduces the same blind spots, which is why the verdict always comes from a licensed clinician who signs it."
    },

    /* --- The rubric ---------------------------------------------------- */
    {
      id: "rubric",
      terms: ["rubric", "what do you check", "criteria", "what do reviewers look at", "dimensions", "how is it scored", "assessment"],
      a: "Six dimensions on every review: <b>medical accuracy</b> (accurate / minor issues / incorrect), <b>hallucination</b> (fabricated content, with details), <b>missing information</b> (omitted differentials or follow-ups), <b>unsafe recommendations</b>, <b>clinical reasoning</b> (strong / questionable / poor), and an overall <b>risk level</b>. Those roll up to one of three verdicts: Verified, Needs revision, or Unsafe."
    },
    {
      id: "verdicts",
      terms: ["verdict", "verified", "unsafe", "needs revision", "pass or fail", "what does verified mean"],
      a: "<b>Verified</b> — accurate, sound reasoning, no hallucination, no unsafe recommendation. Safe to ship. <b>Needs revision</b> — fixable issues: minor inaccuracies, questionable reasoning, or something omitted. <b>Unsafe</b> — do not deploy: incorrect content, flawed reasoning, an unsafe recommendation, or high patient risk."
    },
    {
      id: "corrections",
      terms: ["corrections", "do you fix it", "suggested corrections", "what do i get back", "do you rewrite"],
      a: "Reviewers don't just flag — they write the corrected content, with the source cited. That's the part most customers say is worth the money: not \"this is wrong\" but \"this is wrong, here is what it should say, and here is the label section that says so.\""
    },

    /* --- Pricing -------------------------------------------------------- */
    {
      id: "pricing",
      terms: ["price", "pricing", "cost", "how much", "whats the damage", "price tag", "pay per review", "per case cost", "ballpark", "expensive", "cheap", "budget", "quote", "rates", "fee", "what's the damage"],
      a: "Priced per case, not per seat. Three inputs set it: specialty, case complexity, and how much harm a wrong answer could do. Batches get a 10% volume discount. <a href=\"pricing.html\">The simulator on the pricing page</a> runs the same engine that produces your invoice, so what it quotes is what you'd be charged."
    },
    {
      id: "monitoring-price",
      terms: ["monitoring", "continuous", "monthly", "subscription", "ongoing", "per month", "always on"],
      a: "Continuous monitoring starts at $500/month plus a volume component. We sample your live output, score it, and escalate to a clinician when the risk model flags something. The multipliers are your risk profile, whether you need audit-grade evidence, system type, and batch versus real time. <a href=\"pricing.html#simulator\">Model it here</a>."
    },
    {
      id: "minimum",
      terms: ["minimum", "start small", "few cases", "small batch", "try a few", "can we try", "pilot", "trial", "one case", "commitment", "contract length"],
      a: "No minimum for per-case work — a single case costs what that case costs. Most design partners start by routing twenty real outputs and reading what comes back. No seat licences, no platform fee for per-case work, no annual commitment."
    },
    {
      id: "double-review",
      terms: ["double review", "two reviewers", "second opinion", "independent review", "two experts"],
      a: "Double review means two clinicians assess the same output without seeing each other's work. It costs 1.8× a single review rather than 2× — the second reviewer starts from a case that's already triaged and prepared. Worth it on high-risk material where disagreement between two experts is itself the signal."
    },
    {
      id: "refund",
      terms: ["refund", "money back", "what if it is wrong", "review is wrong", "got it wrong", "mistake", "complain", "dispute", "unhappy", "bad review"],
      a: "If a technical fault on our side stops a review being delivered, it's refunded in full. If you think a completed review was materially wrong, raise it within 30 days: a second independent reviewer looks at the case at our cost, and if the original was materially wrong, it's refunded. <a href=\"terms.html#5-pricing-and-payment\">Terms</a>."
    },
    {
      id: "payment",
      terms: ["payment", "pay", "invoice", "card", "billing", "paystack", "purchase order", "how do i pay"],
      a: "Each accepted quotation creates its own payment page for that exact amount — a link is specific to one purchase and can't be reused at a stale price. Card details are handled by our payment provider and never touch our servers. For enterprise volume we invoice; ask us."
    },

    /* --- Turnaround ----------------------------------------------------- */
    {
      id: "turnaround",
      terms: ["how long", "turnaround", "sla", "how fast", "speed", "when will i get", "deadline", "urgent", "rush"],
      a: "Complexity and risk set the target — and higher clinical risk <em>compresses</em> it rather than extending it. A low-complexity case targets 24 hours; a high-risk case is much tighter, with a two-hour floor because a clinician still has to read it properly. The simulator shows the target for your exact case."
    },
    {
      id: "capacity",
      terms: ["how many", "volume", "capacity", "scale", "thousands", "throughput", "bulk"],
      a: "The reviewer network spans six continents, so cases route to whoever is awake and matched. For sustained high volume, continuous monitoring is the right shape — we sample rather than review everything, and escalate what the risk model flags. Tell us your volume and we'll tell you honestly what we can staff."
    },
    {
      id: "cannot-staff",
      terms: ["what if you can't", "cant find an expert", "no expert available", "no one available", "rare specialty", "unavailable", "can't find"],
      a: "If we can't staff a case with the right specialty, you're told — not billed and not quietly assigned to someone approximate. A verification from the wrong specialist is worse than no verification, because it carries a signature that implies otherwise."
    },

    /* --- Reviewers ------------------------------------------------------ */
    {
      id: "reviewers",
      terms: ["expert", "reviewer", "clinician", "doctor", "physician", "who reviews", "who reviews my output", "who looks at it", "who checks it", "qualifications", "credentials", "board certified"],
      a: "Licensed, practising clinicians — credentialled before admission and matched to your case by specialty. Admission requires at least three years post-qualification practice, a verifiable license, a named institution and a signed agreement, plus a score across eight dimensions. Every review carries the reviewer's name and credentials. <a href=\"experts.html\">Full criteria here</a>."
    },
    {
      id: "reviewer-quality",
      terms: ["how do you know reviewers are good", "reviewer quality", "rating", "2.5", "bad reviewer", "consistency", "who checks the checkers"],
      a: "Reviewers are rated on quality, timeliness and professionalism after every case. An average below 2.5/5 deactivates the account automatically — a server-side check that runs on every rating, not a badge someone has to notice. Putting a human in the loop isn't a guarantee by itself; we measure our own layer too."
    },
    {
      id: "reviewer-identity",
      terms: ["can i choose", "specific reviewer", "same reviewer", "know who reviewed", "anonymous"],
      a: "You see the reviewer's name and credentials on every report — that's the point of a signed record. Enterprise agreements can pin a named panel. You can't contact reviewers outside the platform, which protects both sides."
    },
    {
      id: "become-expert",
      terms: ["apply as expert", "join as a doctor", "become a reviewer", "work for you", "i am a physician", "clinician job", "how do i apply"],
      a: "Clinicians apply through <a href=\"experts.html#apply\">the expert network page</a>. You need three years of post-qualification practice, a verifiable license and a named institution — and every application gets the specific reasons either way, not just \"unsuccessful\". Compensation is $2–$500 per review, shown before you accept a case."
    },

    /* --- Security and data ---------------------------------------------- */
    {
      id: "security",
      terms: ["security", "secure", "privacy", "data", "phi", "patient data", "confidential", "encrypted", "safe"],
      a: "Clinical material is handled as confidential, stored in private object storage rather than database fields, and reachable only through short-lived signed links visible to the assigned reviewer and you. It's never used for advertising and never shared with an analytics provider. <a href=\"privacy.html\">The privacy notice</a> has the specifics."
    },
    {
      id: "compliance",
      terms: ["hipaa", "gdpr", "soc 2", "iso 27001", "certification", "compliant", "attestation", "audit", "certified"],
      a: "Here's the honest answer: we name certifications only once we hold them, and where one is in progress we say what stage it's at. Ask and you'll get the current status in writing rather than a badge. <a href=\"trust.html#claims\">We publish that discipline</a> because a verification company that overstates its own position has already failed at the thing it sells."
    },
    {
      id: "training",
      terms: ["train", "training data", "use my data", "do you keep", "model training", "retain", "own the data"],
      a: "Your submissions are yours. They're used to perform the review and never to train models. Reviewed and corrected examples can be licensed as evaluation datasets — but only with the originating customer's written agreement, never by default."
    },
    {
      id: "deidentify",
      terms: ["de-identify", "deidentify", "anonymize", "remove names", "identifiers", "do i need to strip"],
      a: "Yes — please de-identify before sending, unless your agreement with us says otherwise. Where identifiers do appear, that material is handled as special-category data on your instructions, with the storage and access controls described in the privacy notice."
    },
    {
      id: "residency",
      terms: ["data residency", "where is data stored", "where is my data", "hosted", "servers located", "eu", "region", "cross border", "jurisdiction", "transfer"],
      a: "Reviewers practise in many countries, so a case may be reviewed outside the country it came from. Transfers out of the UK or EEA are made under standard contractual clauses or an adequacy decision, and you can restrict reviewer jurisdictions contractually if your own obligations require it."
    },
    {
      id: "delete",
      terms: ["delete", "delete my data", "do you delete", "retention", "how long do you keep", "erase", "remove my account", "right to be forgotten"],
      a: "Account holders can delete their account from the product. Submissions and reports are kept as your agreement specifies — by default for the life of the account. Audit and access logs are kept 12 months, because an audit trail that expires with the record it describes isn't an audit trail."
    },

    /* --- Submitting ----------------------------------------------------- */
    {
      id: "formats",
      terms: ["format", "file type", "upload", "pdf", "docx", "word", "txt", "image", "json", "csv", "what can i send"],
      a: "PDF, Word (.docx), plain text and images. Anything else needs converting first. You can also paste the output directly rather than uploading a file."
    },
    {
      id: "submit",
      terms: ["how do i submit", "request verification", "send a case", "get started", "submit output", "where do i start"],
      a: "Through <a href=\"request-verification.html\">the request form</a>. You describe the case, attach or paste the output, and get the price and turnaround target before anything is charged or assigned. <a href=\"contact.html\">Request access</a> if you don't have an account yet."
    },
    {
      id: "report",
      terms: ["report", "what do i get", "what do i get back", "what comes back", "what is delivered", "deliverable", "output", "download", "record", "pdf report", "evidence"],
      a: "A signed record containing: the original output, the reviewer's assessment against each of the six rubric dimensions, every correction with its source, the verdict, the risk level, and the reviewer's name and credentials. Written to be handed to a clinical governance committee without translation. Downloadable as PDF or Word from the platform."
    },
    {
      id: "notification",
      terms: ["notify", "email", "how do i know", "when it's done", "alert", "ready"],
      a: "You get an email the moment a verification is complete. The report itself isn't attached — you sign in and download it. Clinical material doesn't travel by email, which is deliberate: an inbox is the easiest place in any organisation to leak a document from."
    },

    /* --- Integration ----------------------------------------------------- */
    {
      id: "api",
      terms: ["api", "integrate", "integration", "sdk", "webhook", "programmatic", "automate", "endpoint"],
      a: "Submissions can be routed programmatically and results returned to your application rather than collected by hand. <a href=\"platform.html#api\">The platform page covers the API</a>. Tell us your stack and we'll tell you what integration actually looks like for you."
    },
    {
      id: "on-prem",
      terms: ["on premise", "on-prem", "self host", "our infrastructure", "vpc", "private cloud", "air gap"],
      a: "That's an enterprise conversation rather than a checkbox — it depends on which parts need to stay inside your boundary. <a href=\"contact.html\">Tell us the constraint</a> and we'll tell you straight whether we can meet it today."
    },

    /* --- Datasets and partners ------------------------------------------ */
    {
      id: "datasets",
      terms: ["dataset", "datasets", "data pack", "licence data", "license data", "buy data", "labelled data", "benchmark", "eval set", "evaluation data"],
      a: "Reviewed and corrected clinical examples — with hallucination labels, risk assessments and expert corrections — can be licensed as evaluation datasets. Priced separately, and only with the originating customer's written agreement. <a href=\"contact.html\">Ask us what's available in your specialty</a>."
    },
    {
      id: "partner",
      terms: ["partner", "partnership", "reseller", "distribution", "work together", "collaborate", "integration partner"],
      a: "Partnerships are assessed on strategic fit, technical readiness, commercial potential, compliance standing and risk. <a href=\"partners.html\">Apply on the partners page</a> — you'll get an assessment across five compatibility dimensions back."
    },
    {
      id: "investor",
      terms: ["invest", "investor", "funding", "raise", "round", "cap table", "deck", "vc"],
      a: "<a href=\"investors.html\">The investors page</a> covers the thesis, the market, how the business makes money and where it is today. There's a form there to request the materials and a conversation with the founder."
    },

    /* --- Objections ------------------------------------------------------ */
    {
      id: "why-not-internal",
      terms: ["why not do it ourselves", "do it ourselves", "internally", "in house", "internal review", "our own clinicians", "we have doctors", "build it ourselves"],
      a: "You can, and some do. The problem is who the evidence convinces. Internal evaluation is a company grading its own exam — governance committees and regulators discount it, and reasonably so. The value here isn't that we're better at reading a note; it's that we have no stake in the answer being yes."
    },
    {
      id: "slow-us-down",
      terms: ["slow", "bottleneck", "delay", "slow us down", "block release", "friction"],
      a: "Verification runs alongside your release, not in front of it. Most teams sample rather than review everything — enough to establish a baseline and catch drift, not enough to gate every ship. If it's blocking you, the sampling rate is wrong, and that's a dial."
    },
    {
      id: "guarantee",
      terms: ["do you guarantee", "is it 100", "will it catch everything", "liability", "who is responsible", "accountable"],
      a: "No, and anyone claiming otherwise is selling something that doesn't exist. Expert review substantially reduces the risk of an incorrect output reaching a clinician; it doesn't reduce it to zero. Clinical responsibility stays with the treating clinician and with you as the deployer. We improve the evidence available to them."
    },
    {
      id: "competitors",
      terms: ["competitor", "competitors", "who are your competitors", "alternative", "versus", "compare", "why you", "different from", "anyone else doing this"],
      a: "Most of what's marketed as AI evaluation in healthcare is automated scoring or crowd annotation. Neither produces something a clinical governance committee accepts, because neither carries a named, credentialled person who is accountable for the judgement. That's the difference, and it's the whole product."
    },
    {
      id: "early",
      terms: ["how big are you", "how many customers", "funding", "are you established", "startup", "how long have you"],
      a: "Harmony Verify is early, and says so on its own company page. Founded by Affriee Darele Yvana — <a href=\"founder.html\">her story is here</a>. If you need a vendor with a decade of references, we're not that yet. If you want to shape how this works while it's still being built, that's exactly the moment."
    },

    /* --- Meta ------------------------------------------------------------ */
    {
      id: "contact",
      terms: ["contact", "talk to someone", "talk to a person", "speak to a person", "speak to someone", "real person", "sales", "book a call", "demo", "meeting", "get in touch"],
      a: "<a href=\"contact.html\">The contact page</a> reaches the team directly, or email hello@harmonyverify.org For a design-partner conversation, send a real sample of your output — it's a far more useful first meeting than a deck."
    },
    {
      id: "cookies",
      terms: ["cookie", "tracking", "consent", "gdpr banner", "analytics"],
      a: "Only strictly necessary cookies run before you choose. Analytics and marketing stay off unless you switch them on, and you can change that any time from the footer. Rejecting deletes those cookies rather than just stopping new ones."
    },
    {
      id: "assistant",
      terms: ["are you a bot", "are you ai", "who am i talking to", "are you a robot", "chatgpt"],
      a: "I'm an assistant on this website, answering from what the site already says. I don't see your submissions, I don't store this conversation, and I won't answer clinical questions. For anything I can't cover, <a href=\"contact.html\">a person will pick it up</a>."
    }
  ]
};
