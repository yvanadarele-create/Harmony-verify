import type { Complexity, RiskLevel, Specialty } from "@harmony/shared";

/**
 * Deterministic clinical classification.
 *
 * This is the rules layer. It runs first, always, and never calls out to a model: an
 * LLM that is slow, rate-limited or hallucinating must not be able to stop a
 * submission being triaged. @harmony/ai-engine can refine these results afterwards,
 * but the platform stays functional without it.
 */

/* --- Specialty detection ------------------------------------------------ */

const SPECIALTY_TERMS: Record<Exclude<Specialty, "other">, readonly string[]> = {
  cardiology: [
    "cardiac", "cardio", "myocardial", "mi ", "stemi", "nstemi", "angina", "heart failure",
    "atrial fibrillation", "afib", "ecg", "ekg", "echocardiogram", "statin", "antiplatelet",
    "clopidogrel", "aspirin", "warfarin", "anticoagulat", "hypertension", "arrhythmia",
    "coronary", "stent", "dapt", "troponin", "ejection fraction",
  ],
  oncology: [
    "cancer", "carcinoma", "tumour", "tumor", "malignan", "metasta", "chemotherapy",
    "radiotherapy", "oncolog", "lymphoma", "leukaemia", "leukemia", "biopsy", "staging",
    "neoadjuvant", "immunotherapy", "her2", "brca", "remission",
  ],
  neurology: [
    "neuro", "stroke", "seizure", "epilep", "migraine", "headache", "parkinson",
    "alzheimer", "dementia", "multiple sclerosis", "neuropath", "meningitis",
    "intracranial", "thunderclap", "cerebral", "tia", "aphasia",
  ],
  radiology: [
    "radiolog", "x-ray", "xray", "ct scan", "mri", "ultrasound", "imaging", "contrast",
    "radiograph", "sonograph", "pet scan", "mammogram", "nodule", "opacity", "lesion on",
  ],
  "general-medicine": [
    "primary care", "general practice", "gp ", "family medicine", "routine", "screening",
    "vaccination", "immunisation", "immunization", "wellness", "check-up", "checkup",
    "diabetes", "thyroid", "anaemia", "anemia",
  ],
};

export interface SpecialtyGuess {
  specialty: Specialty;
  confidence: number;
  matched: string[];
}

/**
 * Scores each specialty by distinct term hits. Distinct terms matter more than raw
 * frequency — one document repeating "cardiac" ten times is weaker evidence than one
 * mentioning troponin, STEMI and DAPT once each.
 */
export function detectSpecialty(text: string): SpecialtyGuess {
  const hay = ` ${text.toLowerCase()} `;
  let best: SpecialtyGuess = { specialty: "other", confidence: 0, matched: [] };

  for (const [specialty, terms] of Object.entries(SPECIALTY_TERMS) as Array<
    [Exclude<Specialty, "other">, readonly string[]]
  >) {
    const matched = terms.filter((t) => hay.includes(t));
    if (matched.length === 0) continue;
    // Saturating score: 4 distinct terms is already strong evidence.
    const confidence = Math.min(1, matched.length / 4);
    if (confidence > best.confidence) best = { specialty, confidence, matched };
  }

  return best;
}

/* --- Complexity --------------------------------------------------------- */

/** Signals that a case needs more of a reviewer's time. */
const COMPLEXITY_SIGNALS: ReadonlyArray<{ term: string; weight: number; why: string }> = [
  { term: "comorbid", weight: 2, why: "comorbidities" },
  { term: "polypharmacy", weight: 2, why: "polypharmacy" },
  { term: "interaction", weight: 2, why: "drug interaction" },
  { term: "contraindicat", weight: 2, why: "contraindication" },
  { term: "differential", weight: 1, why: "differential diagnosis" },
  { term: "renal impairment", weight: 2, why: "renal impairment" },
  { term: "hepatic impairment", weight: 2, why: "hepatic impairment" },
  { term: "pregnan", weight: 2, why: "pregnancy" },
  { term: "paediatric", weight: 2, why: "paediatric" },
  { term: "pediatric", weight: 2, why: "paediatric" },
  { term: "elderly", weight: 1, why: "older adult" },
  { term: "off-label", weight: 2, why: "off-label use" },
  { term: "rare", weight: 1, why: "rare presentation" },
  { term: "atypical", weight: 1, why: "atypical presentation" },
  { term: "multiple", weight: 1, why: "multiple concurrent issues" },
];

export interface ComplexityGuess {
  complexity: Complexity;
  score: number;
  reasons: string[];
}

export function assessComplexity(text: string): ComplexityGuess {
  const hay = text.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const s of COMPLEXITY_SIGNALS) {
    if (hay.includes(s.term)) {
      score += s.weight;
      reasons.push(s.why);
    }
  }

  // Length is a weak but real proxy for how much there is to check.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > 600) { score += 2; reasons.push("long output (>600 words)"); }
  else if (words > 250) { score += 1; reasons.push("moderate length"); }

  const complexity: Complexity = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  return { complexity, score, reasons };
}

/* --- Risk --------------------------------------------------------------- */

/**
 * Terms implying that acting on a wrong output could cause harm quickly.
 * Weighted higher than complexity signals: risk drives escalation, not just price.
 */
const RISK_SIGNALS: ReadonlyArray<{ term: string; weight: number; why: string }> = [
  { term: "dose", weight: 2, why: "dosing guidance" },
  { term: "dosage", weight: 2, why: "dosing guidance" },
  { term: "mg", weight: 1, why: "specific drug quantities" },
  { term: "overdose", weight: 3, why: "overdose risk" },
  { term: "contraindicat", weight: 3, why: "contraindication" },
  { term: "interaction", weight: 3, why: "drug interaction" },
  { term: "emergency", weight: 3, why: "emergency presentation" },
  { term: "urgent", weight: 2, why: "urgency flagged" },
  { term: "chest pain", weight: 3, why: "chest pain" },
  { term: "shortness of breath", weight: 3, why: "respiratory distress" },
  { term: "sepsis", weight: 3, why: "sepsis" },
  { term: "haemorrhage", weight: 3, why: "haemorrhage" },
  { term: "hemorrhage", weight: 3, why: "haemorrhage" },
  { term: "suicid", weight: 3, why: "suicide risk" },
  { term: "anaphyla", weight: 3, why: "anaphylaxis" },
  { term: "discharge", weight: 2, why: "discharge decision" },
  { term: "triage", weight: 2, why: "triage decision" },
  { term: "stop taking", weight: 3, why: "advice to stop medication" },
  { term: "do not", weight: 1, why: "negative instruction" },
  { term: "paediatric", weight: 2, why: "paediatric patient" },
  { term: "pediatric", weight: 2, why: "paediatric patient" },
  { term: "pregnan", weight: 2, why: "pregnancy" },
];

export interface RiskGuess {
  risk: RiskLevel;
  score: number;
  reasons: string[];
}

export function assessRisk(text: string): RiskGuess {
  const hay = text.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const s of RISK_SIGNALS) {
    if (hay.includes(s.term)) {
      score += s.weight;
      reasons.push(s.why);
    }
  }

  const risk: RiskLevel = score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  return { risk, score, reasons: [...new Set(reasons)] };
}
