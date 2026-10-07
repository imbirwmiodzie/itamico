// Grammatica: grammar lessons built from your own words, at /grammar/<token>.
//
// Six lessons: the definite and indefinite articles, plurals, articulated
// prepositions, the present tense and the passato prossimo. Each one explains
// its rules with your nouns and verbs, lists the forms of every word of yours
// it fits, and ends with a practice round asking for those forms.
//
// A word joins a lesson only when its forms can be worked out with confidence.
// Anything irregular that the tables below don't cover (a -co plural that
// could go either way, an -ere verb with an unknown participle, an -ire verb
// that may or may not take -isc-) is left out rather than guessed.
//
// Practising grammar is not recalling the word, so it never touches the
// SM-2 schedule.

import { esc, nav, PAGE_CSS } from "./page.js";

export type GrammarWord = { id: number; italian: string; english: string; note: string | null };

type Gender = "m" | "f";
export type Exercise = { id: number; q: string; en: string; a: string[]; opts?: string[]; rules: string[] };
export type Rule = { key: string; title: string; text: string; stock: string[] };
/** One of your words in a lesson: its forms, and an example for each rule it shows. */
export type Row = { cells: string[]; ex: Record<string, string> };
export type Lesson = {
  key: string;
  it: string;
  title: string;
  intro: string;
  kind: "choice" | "type";
  ask: string;
  cols: string[];
  rules: Rule[];
  rows: Row[];
  exercises: Exercise[];
};

const V = "aeiouàáèéìíòóùú";
const WORD = /^[a-zàáèéìíòóùú]+$/;
const isVowel = (c: string | undefined) => !!c && V.includes(c);
const tidy = (s: string) => s.trim().replace(/[’`]/g, "'").replace(/\s+/g, " ").toLowerCase();
const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const words = (s: string) => s.split(" ");

// ── Nouns ────────────────────────────────────────────────────────────────

export type Noun = { id: number; en: string; art: string; noun: string; plural: boolean; gender: Gender | null };

/** Starts with a sound that takes lo / uno / gli: s + consonant, z, gn, ps, pn, x, y, i + vowel. */
const loSound = (w: string) => /^(s[^aeiouàèéìòù]|z|gn|ps|pn|x|y|i[aeiouàèéìòù])/.test(w);
/** Starts with a vowel sound, h included (l'hotel). Not i + vowel, which is a consonant sound. */
const vowelSound = (w: string) => /^h?[aeiouàèéìòù]/.test(w) && !/^h?i[aeiouàèéìòù]/.test(w);

export function definite(noun: string, g: Gender, plural: boolean): string {
  if (plural) return g === "f" ? "le" : loSound(noun) || vowelSound(noun) ? "gli" : "i";
  if (g === "f") return vowelSound(noun) ? "l'" : "la";
  return loSound(noun) ? "lo" : vowelSound(noun) ? "l'" : "il";
}

export function indefinite(noun: string, g: Gender): string {
  if (g === "f") return vowelSound(noun) ? "un'" : "una";
  return loSound(noun) ? "uno" : "un";
}

/** Article and noun as written: no space after an apostrophe. */
export const withArt = (art: string, noun: string) => (art.endsWith("'") ? art + noun : `${art} ${noun}`);

/** The gender behind l': from the note if it says, otherwise from the ending where that's reliable. */
function elidedGender(noun: string, note: string | null): Gender | null {
  if (note && /\b(fem|femminile)/i.test(note)) return "f";
  if (note && /\b(masc|maschile)/i.test(note)) return "m";
  if (noun === "auto") return "f";
  if (/(tà|tù|zione|sione|tudine|igine)$/.test(noun)) return "f";
  if (/ore$/.test(noun)) return "m";
  if (/(ista|ma|eta|ota|auta|cida|iatra|ega|eco)$/.test(noun)) return null;
  if (noun.endsWith("o")) return "m";
  if (noun.endsWith("a")) return "f";
  return null;
}

/**
 * A word saved as article + one noun ("lo schermo", "l'amica", "le chiavi"),
 * with its gender. Null for anything else, or when the article doesn't follow
 * the rules (so the lessons never teach an exception as a rule).
 */
export function parseNoun(w: GrammarWord): Noun | null {
  const s = tidy(w.italian);
  const m = s.match(/^(il|lo|la|i|gli|le) (\S+)$/) ?? s.match(/^(l')(\S+)$/);
  if (!m || !WORD.test(m[2]) || ![...m[2]].some((c) => isVowel(c))) return null;
  const [, art, noun] = m;
  const plural = art === "i" || art === "gli" || art === "le";
  const gender: Gender | null = art === "l'" ? elidedGender(noun, w.note) : art === "la" || art === "le" ? "f" : "m";
  if (gender ? definite(noun, gender, plural) !== art : !vowelSound(noun)) return null;
  return { id: w.id, en: w.english, art, noun, plural, gender };
}

// Plural nouns that change gender or form. [plural, gender of the plural]
const IRREGULAR_PL: Record<string, [string, Gender]> = {
  uomo: ["uomini", "m"], dio: ["dei", "m"], bue: ["buoi", "m"], tempio: ["templi", "m"],
  uovo: ["uova", "f"], braccio: ["braccia", "f"], dito: ["dita", "f"], ginocchio: ["ginocchia", "f"],
  labbro: ["labbra", "f"], osso: ["ossa", "f"], paio: ["paia", "f"], lenzuolo: ["lenzuola", "f"],
  centinaio: ["centinaia", "f"], migliaio: ["migliaia", "f"], ciglio: ["ciglia", "f"],
  sopracciglio: ["sopracciglia", "f"], mano: ["mani", "f"], ala: ["ali", "f"], arma: ["armi", "f"], moglie: ["mogli", "f"],
};
// Shortened or borrowed words that don't change.
const SHORT = new Set(["foto", "moto", "auto", "radio", "bici", "cinema", "frigo", "metro", "video", "euro", "zoo"]);
// Stressed -ìo: zio → zii.
const STRESSED_IO = new Set(["zio", "pendio", "addio", "fruscio", "leggio", "brusio", "mormorio", "rinvio", "invio", "ronzio", "oblio", "calpestio", "cigolio", "gorgoglio", "luccichio", "scintillio"]);
// Masculine -co / -go: no rule decides between -chi and -ci, so only these.
const CO_CI = new Set([
  "amico", "nemico", "greco", "porco", "medico", "meccanico", "tecnico", "politico", "sindaco", "monaco", "comico", "chimico",
  "fisico", "manico", "portico", "parroco", "traffico", "farmaco", "classico", "critico", "cattolico", "pubblico",
  "asparago", "psicologo", "biologo", "geologo", "astrologo", "teologo", "archeologo", "radiologo", "sociologo",
  "filologo", "ginecologo", "cardiologo", "dermatologo", "oncologo", "neurologo", "antropologo", "zoologo",
]);
const CO_CHI = new Set([
  "parco", "fuoco", "gioco", "buco", "banco", "sacco", "tacco", "fico", "cuoco", "bosco", "disco", "arco", "elenco", "palco",
  "tocco", "blocco", "fiocco", "tedesco", "affresco", "chiosco", "carico", "incarico", "scarico", "valico", "succo", "trucco",
  "pacco", "gnocco", "tabacco", "stucco", "lago", "luogo", "fungo", "albergo", "dialogo", "catalogo", "monologo", "prologo",
  "ago", "sugo", "rogo", "obbligo", "mago",
]);

export type Plural = { art: string; noun: string; rule: string };

/** The plural of a singular noun with its article, or null when it can't be told for sure. */
export function pluralOf(n: Noun): Plural | null {
  if (n.plural || !n.gender) return null;
  const w = n.noun;
  const out = (noun: string, rule: string, g: Gender = n.gender!) => ({ art: definite(noun, g, true), noun, rule });
  const irr = IRREGULAR_PL[w];
  if (irr) return w === "dio" ? { art: "gli", noun: "dei", rule: "irr" } : out(irr[0], "irr", irr[1]);
  // One syllable (re, gru), but zio and via are two.
  const oneSyllable = w.match(/[aeiouàáèéìíòóùú]+/g)!.length === 1 && !/i[ao]$/.test(w);
  if (/[àáèéìíòóùú]$/.test(w) || !isVowel(w.at(-1)) || oneSyllable || /i$|ie$/.test(w) || SHORT.has(w)) return out(w, "inv");
  const stem = w.slice(0, -1);
  if (n.gender === "m") {
    if (w.endsWith("io")) return STRESSED_IO.has(w) ? out(stem + "i", "io") : out(stem, "io");
    if (/[cg]o$/.test(w)) {
      if (CO_CI.has(w)) return out(stem + "i", "co-ci");
      if (CO_CHI.has(w)) return out(stem + "hi", "co-chi");
      return null;
    }
    if (w.endsWith("o")) return out(stem + "i", "o-i");
    if (w.endsWith("e")) return out(stem + "i", "e-i");
    if (w.endsWith("a")) return out(/[cg]a$/.test(w) ? stem + "hi" : stem + "i", "a-i");
    return null;
  }
  if (w.endsWith("a")) {
    const cia = w.match(/(.)([cg])ia$/);
    if (cia) {
      // -cie / -gie after a vowel, and where the i is stressed (allergìa); -ce / -ge after a consonant.
      const keep = isVowel(cia[1]) || (cia[2] === "g" && !/[gn]/.test(cia[1]));
      return out(w.slice(0, -2) + (keep ? "ie" : "e"), "cia");
    }
    if (/[cg]a$/.test(w)) return out(stem + "he", "ca");
    return out(stem + "e", "a-e");
  }
  if (w.endsWith("e")) return out(stem + "i", "e-i");
  return null;
}

// ── Verbs ────────────────────────────────────────────────────────────────

export type Verb = { id: number; en: string; inf: string; base: string; rest: string; refl: boolean };

/** A word saved as an infinitive, maybe with more after it ("fare la spesa", "alzarsi"). */
export function parseVerb(w: GrammarWord): Verb | null {
  if (!/^to\s/i.test(w.english.trim()) && !/\bverb/i.test(w.note ?? "")) return null;
  const [head, ...rest] = words(tidy(w.italian));
  if (!WORD.test(head)) return null;
  let base = head;
  const refl = /(a|e|i|o|u)rsi$/.test(head);
  if (refl) {
    base = head.slice(0, -2);
    base += /[ou]r$/.test(base) || TRARRE.has(base) ? "re" : "e";
  }
  if (!/(are|ere|ire|rre)$/.test(base) || base.length < 4) return null;
  return { id: w.id, en: w.english, inf: head, base, rest: rest.join(" "), refl };
}

// Reflexives of trarre: distrarsi → distrarre, but mostrarsi → mostrare.
const TRARRE = new Set(["trar", "distrar", "sottrar", "ritrar", "attrar", "estrar"]);
// Compounds that don't follow fare, dare, stare or andare as written (rifà, ridò), or
// whose forms vary (soddisfo, soddisfaccio): left out.
const UNSURE = (v: string) => (v.endsWith("fare") && v !== "fare") || ["ridare", "sottostare", "soprastare", "ristare", "riandare"].includes(v);

const PERSONS = ["io", "tu", "lui/lei", "noi", "voi", "loro"];
const REFL = ["mi", "ti", "si", "ci", "vi", "si"];

// Irregular presents, with the prefixes their compounds take (null: any).
const IRR_PRESENT: [string, string, string[] | null][] = [
  ["essere", "sono sei è siamo siete sono", [""]],
  ["avere", "ho hai ha abbiamo avete hanno", [""]],
  ["andare", "vado vai va andiamo andate vanno", [""]],
  ["fare", "faccio fai fa facciamo fate fanno", [""]],
  ["dare", "do dai dà diamo date danno", [""]],
  ["stare", "sto stai sta stiamo state stanno", [""]],
  ["dire", "dico dici dice diciamo dite dicono", ["", "ri", "dis", "contrad", "bene", "male", "pre"]],
  ["venire", "vengo vieni viene veniamo venite vengono", null],
  ["tenere", "tengo tieni tiene teniamo tenete tengono", null],
  ["dovere", "devo devi deve dobbiamo dovete devono", [""]],
  ["potere", "posso puoi può possiamo potete possono", [""]],
  ["volere", "voglio vuoi vuole vogliamo volete vogliono", [""]],
  ["sapere", "so sai sa sappiamo sapete sanno", [""]],
  ["bere", "bevo bevi beve beviamo bevete bevono", [""]],
  ["uscire", "esco esci esce usciamo uscite escono", ["", "ri"]],
  ["salire", "salgo sali sale saliamo salite salgono", ["", "ri"]],
  ["morire", "muoio muori muore moriamo morite muoiono", [""]],
  ["rimanere", "rimango rimani rimane rimaniamo rimanete rimangono", [""]],
  ["sedere", "siedo siedi siede sediamo sedete siedono", ["", "pos"]],
  ["piacere", "piaccio piaci piace piacciamo piacete piacciono", ["", "dis", "com"]],
  ["tacere", "taccio taci tace tacciamo tacete tacciono", [""]],
  ["cuocere", "cuocio cuoci cuoce cuociamo cuocete cuociono", ["", "ri"]],
  ["spegnere", "spengo spegni spegne spegniamo spegnete spengono", [""]],
  ["valere", "valgo vali vale valiamo valete valgono", ["", "pre", "equi"]],
  ["udire", "odo odi ode udiamo udite odono", [""]],
  ["parere", "paio pari pare paiamo parete paiono", [""]],
  ["giacere", "giaccio giaci giace giacciamo giacete giacciono", [""]],
  ["porre", "pongo poni pone poniamo ponete pongono", null],
  ["durre", "duco duci duce duciamo ducete ducono", null],
  ["trarre", "traggo trai trae traiamo traete traggono", null],
  ["gliere", "lgo gli glie gliamo gliete lgono", null], // scegliere: scelgo, scegli…
];
const ISC = new Set([
  "capire", "finire", "preferire", "pulire", "spedire", "costruire", "colpire", "sparire", "suggerire", "gestire", "restituire",
  "tradire", "ubbidire", "obbedire", "unire", "riunire", "fornire", "garantire", "impedire", "reagire", "agire", "chiarire",
  "definire", "dimagrire", "distribuire", "favorire", "ferire", "fiorire", "guarire", "impazzire", "inserire", "istruire",
  "sostituire", "stabilire", "trasferire", "contribuire", "attribuire", "abolire", "arrossire", "demolire", "digerire",
  "esaurire", "condire", "interferire", "percepire", "proibire", "punire", "riferire", "smarrire", "svanire", "ingrandire",
  "arricchire", "impallidire", "aderire", "approfondire", "gradire", "influire", "intuire", "partorire", "rimbambire",
  "stupire", "zittire", "addolcire", "ammonire", "concepire", "custodire", "diminuire",
]);
const NOT_ISC = new Set([
  "aprire", "riaprire", "coprire", "scoprire", "ricoprire", "offrire", "soffrire", "dormire", "partire", "sentire", "seguire",
  "inseguire", "eseguire", "conseguire", "proseguire", "servire", "vestire", "rivestire", "travestire", "divertire", "avvertire",
  "convertire", "investire", "pentire", "fuggire", "sfuggire", "bollire", "consentire", "acconsentire",
]);
// -iare verbs whose i is stressed in the tu form: invii, not invi.
const STRESSED_IARE = new Set(["inviare", "rinviare", "sciare", "spiare", "avviare", "deviare", "obliare"]);

function family<T>(table: [string, T, string[] | null][], v: string): [prefix: string, value: T] | null {
  for (const [base, value, prefixes] of table) {
    if (!v.endsWith(base)) continue;
    const prefix = v.slice(0, -base.length);
    if (prefixes ? prefixes.includes(prefix) : base !== "durre" || prefix) return [prefix, value];
  }
  return null;
}

export type Conjugation = { forms: string[]; rules: string[] };

/** Present tense, io → loro, of an infinitive (reflexives as their base verb). */
export function presentOf(v: string): Conjugation | null {
  const irr = family(IRR_PRESENT, v);
  if (irr) return { forms: irr[1].split(" ").map((f) => irr[0] + f), rules: ["irr"] };
  if (UNSURE(v) || ["nuocere", "dolere", "solere"].includes(v)) return null;
  const stem = v.slice(0, -3);
  if (v.endsWith("are")) {
    if (/[cg]$/.test(stem)) {
      return { forms: [stem + "o", stem + "hi", stem + "a", stem + "hiamo", stem + "ate", stem + "ano"], rules: ["care"] };
    }
    if (stem.endsWith("i")) {
      const s = stem.slice(0, -1);
      return { forms: [stem + "o", STRESSED_IARE.has(v) ? stem + "i" : stem, stem + "a", s + "iamo", stem + "ate", stem + "ano"], rules: ["iare"] };
    }
    return { forms: [stem + "o", stem + "i", stem + "a", stem + "iamo", stem + "ate", stem + "ano"], rules: ["are"] };
  }
  if (v.endsWith("ere")) {
    return { forms: [stem + "o", stem + "i", stem + "e", stem + "iamo", stem + "ete", stem + "ono"], rules: ["ere"] };
  }
  if (v.endsWith("ire")) {
    if (ISC.has(v)) return { forms: [stem + "isco", stem + "isci", stem + "isce", stem + "iamo", stem + "ite", stem + "iscono"], rules: ["isc"] };
    if (NOT_ISC.has(v)) return { forms: [stem + "o", stem + "i", stem + "e", stem + "iamo", stem + "ite", stem + "ono"], rules: ["ire"] };
  }
  return null;
}

// Irregular participles, with the prefixes their compounds take (null: any).
const IRR_PARTICIPLE: [string, string, string[] | null][] = [
  ["essere", "stato", [""]], ["stare", "stato", [""]], ["fare", "fatto", ["", "ri"]],
  ["dire", "detto", ["", "ri", "dis", "contrad", "bene", "male", "pre"]], ["venire", "venuto", null], ["porre", "posto", null],
  ["durre", "dotto", null], ["trarre", "tratto", null], ["gliere", "lto", null], ["bere", "bevuto", [""]],
  ["vedere", "visto", ["", "ri", "pre"]], ["mettere", "messo", null], ["scrivere", "scritto", null], ["leggere", "letto", ["", "ri", "e"]],
  ["rompere", "rotto", null], ["chiudere", "chiuso", null], ["cludere", "cluso", null], ["aprire", "aperto", ["", "ri"]],
  ["coprire", "coperto", null], ["offrire", "offerto", [""]], ["soffrire", "sofferto", [""]], ["morire", "morto", [""]],
  ["nascere", "nato", ["", "ri"]], ["rimanere", "rimasto", [""]], ["rispondere", "risposto", ["", "cor"]],
  ["chiedere", "chiesto", ["", "ri"]], ["correre", "corso", null], ["cidere", "ciso", null], ["ridere", "riso", ["", "sor", "de"]],
  ["videre", "viso", null], ["perdere", "perso", [""]], ["muovere", "mosso", null], ["piangere", "pianto", ["", "rim"]],
  ["pingere", "pinto", null], ["fingere", "finto", [""]], ["vincere", "vinto", null], ["spegnere", "spento", [""]],
  ["accendere", "acceso", [""]], ["scendere", "sceso", null], ["pendere", "peso", null], ["fendere", "feso", null],
  ["tendere", "teso", null], ["rendere", "reso", null], ["vivere", "vissuto", ["", "soprav", "con", "ri"]],
  ["conoscere", "conosciuto", ["", "ri"]], ["crescere", "cresciuto", null], ["piacere", "piaciuto", ["", "dis", "com"]],
  ["tacere", "taciuto", [""]], ["cuocere", "cotto", ["", "ri"]], ["cutere", "cusso", null], ["succedere", "successo", [""]],
  ["concedere", "concesso", [""]], ["primere", "presso", null], ["stinguere", "stinto", null], ["ungere", "unto", null],
  ["sumere", "sunto", null], ["solvere", "solto", null], ["volgere", "volto", null], ["torcere", "torto", null],
  ["porgere", "porto", [""]], ["sorgere", "sorto", ["", "ri"]], ["accorgere", "accorto", [""]], ["scorgere", "scorto", [""]],
  ["sistere", "sistito", null], ["mergere", "merso", null], ["mordere", "morso", [""]], ["vadere", "vaso", null], ["nascondere", "nascosto", [""]],
  ["apparire", "apparso", [""]], ["comparire", "comparso", ["", "s"]], ["valere", "valso", ["", "pre"]],
];
// -ere verbs whose participle is regular (-uto). Other -ere verbs are left out.
const REGULAR_ERE = new Set([
  "avere", "credere", "ricevere", "battere", "combattere", "abbattere", "vendere", "ripetere", "temere", "cadere", "accadere",
  "sedere", "possedere", "godere", "cedere", "procedere", "sapere", "potere", "volere", "dovere", "premere", "tenere",
  "mantenere", "ottenere", "contenere", "sostenere", "trattenere", "appartenere", "fremere",
]);
// Verbs that take essere. Verbs that take either (salire, correre, passare…) are left out.
const ESSERE = new Set([
  "essere", "stare", "andare", "venire", "arrivare", "partire", "tornare", "ritornare", "entrare", "uscire", "riuscire", "restare",
  "rimanere", "diventare", "divenire", "nascere", "morire", "cadere", "accadere", "succedere", "sembrare", "parere", "piacere",
  "dispiacere", "costare", "durare", "bastare", "capitare", "dimagrire", "ingrassare", "invecchiare", "sparire", "scomparire",
  "apparire", "comparire", "fuggire", "scappare", "emergere", "esistere", "dipendere", "giungere", "sorgere", "svenire", "avvenire",
  "intervenire", "provenire", "crollare", "impazzire", "arrossire", "evadere", "occorrere",
]);
const EITHER = new Set([
  "salire", "scendere", "crescere", "correre", "passare", "cambiare", "cominciare", "iniziare", "finire", "terminare", "guarire",
  "mancare", "vivere", "volare", "saltare", "servire", "aumentare", "diminuire", "migliorare", "peggiorare", "continuare",
  "suonare", "bruciare", "girare", "convenire", "atterrare", "affondare", "annegare", "appartenere", "piovere", "nevicare",
]);

export type Perfect = { aux: "avere" | "essere"; pp: string; rules: string[] };

/** Auxiliary and participle for the passato prossimo, or null when unsure. */
export function perfectOf(v: string, refl: boolean): Perfect | null {
  if (!refl && EITHER.has(v)) return null;
  const aux = refl || ESSERE.has(v) ? "essere" : "avere";
  const rules = [refl ? "refl" : aux];
  const irr = family(IRR_PARTICIPLE, v);
  if (irr) return { aux, pp: irr[0] + irr[1], rules: [...rules, "irr"] };
  if (UNSURE(v)) return null;
  const stem = v.slice(0, -3);
  if (v.endsWith("are")) return { aux, pp: stem + "ato", rules: [...rules, "pp"] };
  if (v.endsWith("ire")) return { aux, pp: stem + "ito", rules: [...rules, "pp"] };
  if (v.endsWith("ere") && REGULAR_ERE.has(v)) return { aux, pp: stem + "uto", rules: [...rules, "pp"] };
  return null;
}

// ── Lessons ──────────────────────────────────────────────────────────────

const RULES = {
  articoli: [
    { key: "il", title: "il", text: "Masculine, before most consonants.", stock: ["il libro", "il treno"] },
    { key: "lo", title: "lo", text: "Masculine, before s + consonant, z, gn, ps, pn, x, y and i + vowel.", stock: ["lo zaino", "lo studente", "lo gnomo"] },
    { key: "l'", title: "l'", text: "Before a vowel (or a silent h), masculine or feminine: lo and la drop their vowel.", stock: ["l'albero", "l'amica", "l'hotel"] },
    { key: "la", title: "la", text: "Feminine, before a consonant, and before i + vowel.", stock: ["la casa", "la strada"] },
    { key: "i", title: "i", text: "Masculine plural, for the words that take il.", stock: ["i libri", "i treni"] },
    { key: "gli", title: "gli", text: "Masculine plural, for the words that take lo or l'.", stock: ["gli zaini", "gli alberi"] },
    { key: "le", title: "le", text: "Feminine plural, always. It isn't elided: le amiche.", stock: ["le case", "le amiche"] },
  ],
  un: [
    { key: "un", title: "un", text: "Masculine, before a consonant and also before a vowel, without an apostrophe.", stock: ["un libro", "un amico"] },
    { key: "uno", title: "uno", text: "Masculine, before the sounds that take lo: s + consonant, z, gn, ps, x, y.", stock: ["uno zaino", "uno studente"] },
    { key: "una", title: "una", text: "Feminine, before a consonant.", stock: ["una casa", "una strada"] },
    { key: "un'", title: "un'", text: "Feminine, before a vowel: here the apostrophe is needed.", stock: ["un'amica", "un'isola"] },
  ],
  plurale: [
    { key: "o-i", title: "-o → -i", text: "Masculine words in -o.", stock: ["il libro → i libri"] },
    { key: "a-e", title: "-a → -e", text: "Feminine words in -a.", stock: ["la casa → le case"] },
    { key: "e-i", title: "-e → -i", text: "Words in -e, masculine and feminine alike.", stock: ["il fiore → i fiori", "la chiave → le chiavi"] },
    { key: "a-i", title: "-a → -i", text: "The few masculine words in -a, many of them from Greek.", stock: ["il problema → i problemi", "il collega → i colleghi"] },
    { key: "ca", title: "-ca, -ga → -che, -ghe", text: "The h keeps the hard sound of c and g.", stock: ["l'amica → le amiche", "la riga → le righe"] },
    { key: "cia", title: "-cia, -gia", text: "After a vowel the i stays (-cie, -gie); after a consonant it goes (-ce, -ge).", stock: ["la camicia → le camicie", "l'arancia → le arance"] },
    { key: "co-chi", title: "-co, -go → -chi, -ghi", text: "Most words stressed on the second-to-last syllable keep the hard sound.", stock: ["il parco → i parchi", "il lago → i laghi"] },
    { key: "co-ci", title: "-co, -go → -ci, -gi", text: "Most words stressed earlier, and amico, nemico, greco, porco, go soft.", stock: ["il medico → i medici", "l'amico → gli amici"] },
    { key: "io", title: "-io → -i", text: "One i, unless the i is stressed: lo zio → gli zii.", stock: ["il negozio → i negozi", "lo zio → gli zii"] },
    { key: "inv", title: "Unchanged", text: "Words ending in an accented vowel, a consonant, -i or -ie; one-syllable words; shortened words.", stock: ["la città → le città", "il bar → i bar", "la foto → le foto"] },
    { key: "irr", title: "Irregular", text: "A few change form, and some become feminine in the plural.", stock: ["l'uomo → gli uomini", "l'uovo → le uova", "la mano → le mani"] },
    { key: "art", title: "The article", text: "il → i; lo and masculine l' → gli; la and feminine l' → le.", stock: ["lo zaino → gli zaini", "l'amico → gli amici", "l'amica → le amiche"] },
  ],
  preposizioni: [
    ...(
      [["di", "de"], ["a", "a"], ["da", "da"], ["in", "ne"], ["su", "su"]] as const
    ).map(([p, b]) => ({
      key: p,
      title: p,
      text: ["il", "lo", "la", "l'", "i", "gli", "le"].map((a) => `${p} + ${a} = ${merge(b, a)}`).join(", ") + ".",
      stock: [`${merge(b, "il")} treno`, `${merge(b, "gli")} amici`],
    })),
    { key: "other", title: "con, per, tra, fra", text: "These stay apart from the article: con il treno, per la strada, tra gli amici.", stock: [] },
  ],
  presente: [
    { key: "are", title: "-are", text: "-o, -i, -a, -iamo, -ate, -ano.", stock: ["parlare: parlo, parli, parla, parliamo, parlate, parlano"] },
    { key: "ere", title: "-ere", text: "-o, -i, -e, -iamo, -ete, -ono.", stock: ["prendere: prendo, prendi, prende, prendiamo, prendete, prendono"] },
    { key: "ire", title: "-ire", text: "-o, -i, -e, -iamo, -ite, -ono.", stock: ["dormire: dormo, dormi, dorme, dormiamo, dormite, dormono"] },
    { key: "isc", title: "-ire with -isc-", text: "Many -ire verbs add -isc- except for noi and voi: -isco, -isci, -isce, -iamo, -ite, -iscono.", stock: ["capire: capisco, capisci, capisce, capiamo, capite, capiscono"] },
    { key: "care", title: "-care, -gare", text: "Add h before i to keep the hard sound: cerchi, paghiamo.", stock: ["cercare: cerco, cerchi, cerca, cerchiamo…"] },
    { key: "iare", title: "-iare", text: "No double i: mangi, studiamo. Only a stressed i stays: invii.", stock: ["mangiare: mangio, mangi, mangia, mangiamo…"] },
    { key: "irr", title: "Irregular", text: "Learn these by heart; their compounds follow them (tenere → mantenere).", stock: ["andare: vado, vai, va, andiamo, andate, vanno"] },
    { key: "refl", title: "Reflexive", text: "-arsi, -ersi, -irsi: mi, ti, si, ci, vi, si before the verb.", stock: ["alzarsi: mi alzo, ti alzi, si alza…"] },
  ],
  passato: [
    { key: "avere", title: "avere + participle", text: "Most verbs. The participle stays in -o: ho mangiato, abbiamo mangiato.", stock: ["ho mangiato", "abbiamo visto"] },
    { key: "essere", title: "essere + participle", text: "Verbs of motion and change (andare, venire, partire, nascere, diventare), and piacere. The participle agrees like an adjective: è andata, siamo andati.", stock: ["sono andata", "siamo partiti"] },
    { key: "refl", title: "Reflexive verbs", text: "Always essere, with the pronoun first: mi sono alzata.", stock: ["mi sono alzato", "si sono vestite"] },
    { key: "pp", title: "Regular participles", text: "-are → -ato, -ere → -uto, -ire → -ito.", stock: ["parlare → parlato", "dormire → dormito"] },
    { key: "irr", title: "Irregular participles", text: "Mostly -ere verbs; compounds follow them (prendere → preso, sorprendere → sorpreso).", stock: ["fare → fatto", "prendere → preso", "mettere → messo"] },
  ],
} satisfies Record<string, Rule[]>;

function merge(base: string, art: string): string {
  return base + ({ il: "l", lo: "llo", la: "lla", "l'": "ll'", i: "i", gli: "gli", le: "lle" } as Record<string, string>)[art];
}
const PREPS = [["di", "de"], ["a", "a"], ["da", "da"], ["in", "ne"], ["su", "su"]] as const;

const choices = (right: string, all: string[]) => [right, ...shuffle(all.filter((o) => o !== right)).slice(0, 3)];

/** All six lessons, worked out on these words. */
export function buildLessons(list: GrammarWord[]): Lesson[] {
  const nouns = list.map(parseNoun).filter((n): n is Noun => n !== null);
  const verbs = list.map(parseVerb).filter((v): v is Verb => v !== null);
  const lessons: Lesson[] = [];

  // Definite article
  {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const word = withArt(n.art, n.noun);
      rows.push({ cells: [word, n.en], ex: { [n.art]: word } });
      exercises.push({
        id: n.id, q: `___ ${n.noun}`, en: n.en, a: [n.art],
        opts: n.plural ? ["i", "gli", "le"] : ["il", "lo", "la", "l'"], rules: [n.art],
      });
    }
    lessons.push({
      key: "articoli", it: "Gli articoli", title: "The definite article: il, lo, la, l', i, gli, le", kind: "choice",
      ask: "Which article?",
      intro: "Every noun has a gender, and the article shows it. Which article you need depends on the gender, on singular or plural, and on the sound the noun starts with. The surest way to know a noun's gender is to learn it with its article, which is how your words are saved.",
      cols: ["Word", "English"], rules: RULES.articoli, rows, exercises,
    });
  }

  // Indefinite article
  {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      if (n.plural || !n.gender) continue;
      const art = indefinite(n.noun, n.gender);
      const word = withArt(art, n.noun);
      rows.push({ cells: [withArt(n.art, n.noun), word, n.en], ex: { [art]: word } });
      exercises.push({ id: n.id, q: `___ ${n.noun}`, en: n.en, a: [art], opts: ["un", "uno", "una", "un'"], rules: [art] });
    }
    lessons.push({
      key: "un", it: "Un, uno, una, un'", title: "The indefinite article", kind: "choice", ask: "Which article?",
      intro: "The indefinite article (a, an) follows the same sounds as the definite one: uno where you'd say lo, una where you'd say la. The trap is the apostrophe: it's only for feminine words (un'amica), never masculine ones (un amico).",
      cols: ["Word", "Indefinite", "English"], rules: RULES.un, rows, exercises,
    });
  }

  // Plurals
  {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const p = pluralOf(n);
      if (!p) continue;
      const sg = withArt(n.art, n.noun), pl = withArt(p.art, p.noun);
      const rules = [p.rule, ...(n.art === "lo" || n.art === "l'" ? ["art"] : [])];
      rows.push({ cells: [sg, pl, n.en], ex: Object.fromEntries(rules.map((r) => [r, `${sg} → ${pl}`])) });
      exercises.push({ id: n.id, q: sg, en: n.en, a: [pl], rules });
    }
    lessons.push({
      key: "plurale", it: "Il plurale", title: "Plurals, article included", kind: "type", ask: "Plurale?",
      intro: "The ending of a noun changes in the plural, and so does its article. Most words follow the first three rules; the rest are about keeping the sound of c and g, and the words that never change.",
      cols: ["Singular", "Plural", "English"], rules: RULES.plurale, rows, exercises,
    });
  }

  // Articulated prepositions
  {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const forms: { art: string; noun: string; plural: boolean }[] = [n];
      const p = !n.plural && pluralOf(n);
      if (p) forms.push({ ...p, plural: true });
      const merged = PREPS.map(([, b]) => (n.art === "l'" ? merge(b, "l'") + n.noun : `${merge(b, n.art)} ${n.noun}`));
      rows.push({ cells: [withArt(n.art, n.noun), ...merged], ex: Object.fromEntries(PREPS.map(([p], i) => [p, merged[i]])) });
      for (const f of forms) {
        const arts = f.plural ? ["i", "gli", "le"] : ["il", "lo", "la", "l'"];
        for (const [prep, b] of PREPS) {
          const phrase = (a: string) => (a.endsWith("'") ? merge(b, a) + f.noun : `${merge(b, a)} ${f.noun}`);
          const right = phrase(f.art);
          const wrong = arts.filter((a) => a !== f.art).map(phrase);
          if (f.plural) wrong.push(`${prep} ${f.art} ${f.noun}`);
          exercises.push({ id: n.id, q: `${prep} + ${withArt(f.art, f.noun)}`, en: n.en, a: [right], opts: choices(right, wrong), rules: [prep] });
        }
      }
    }
    lessons.push({
      key: "preposizioni", it: "Le preposizioni articolate", title: "di, a, da, in, su + the article", kind: "choice", ask: "Which is right?",
      intro: "Five prepositions merge with the definite article into one word: in + il = nel, di + la = della. The ending copies the article, with a double l where the article starts with l (dello, della, dell', delle).",
      cols: ["Word", "di", "a", "da", "in", "su"], rules: RULES.preposizioni, rows, exercises,
    });
  }

  // Present tense
  {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const v of verbs) {
      const c = presentOf(v.base);
      if (!c) continue;
      const forms = c.forms.map((f, i) => (v.refl ? `${REFL[i]} ${f}` : f) + (v.rest ? ` ${v.rest}` : ""));
      const rules = v.refl ? ["refl", ...c.rules] : c.rules;
      const whole = `${v.inf}${v.rest ? ` ${v.rest}` : ""}`;
      rows.push({ cells: [whole, ...forms], ex: Object.fromEntries(rules.map((r) => [r, `${whole}: ${forms.slice(0, 3).join(", ")}…`])) });
      forms.forEach((f, i) => exercises.push({ id: v.id, q: `(${PERSONS[i]}) ${whole}`, en: v.en, a: [f], rules }));
    }
    lessons.push({
      key: "presente", it: "Il presente", title: "The present tense", kind: "type", ask: "Presente?",
      intro: "Drop -are, -ere or -ire and add the ending for the person. The three groups differ only in a few endings; the rest is spelling (cerchi, mangi) and the irregular verbs, which happen to be the most common ones.",
      cols: ["Verb", ...PERSONS], rules: RULES.presente, rows, exercises,
    });
  }

  // Passato prossimo
  {
    const rows: Row[] = [], exercises: Exercise[] = [];
    const AVERE = "ho hai ha ha abbiamo avete hanno".split(" ");
    const ESS = "sono sei è è siamo siete sono".split(" ");
    const WHO = ["io", "tu", "lui", "lei", "noi", "voi", "loro"];
    // Endings that agree with each person when the auxiliary is essere: either gender for io and tu.
    const AGREE = [["o", "a"], ["o", "a"], ["o"], ["a"], ["i", "e"], ["i", "e"], ["i", "e"]];
    for (const v of verbs) {
      const p = perfectOf(v.base, v.refl);
      if (!p) continue;
      const tail = v.rest ? ` ${v.rest}` : "";
      const say = (i: number) =>
        p.aux === "avere"
          ? [`${AVERE[i]} ${p.pp}${tail}`]
          : AGREE[i].map((e) => `${v.refl ? `${REFL[[0, 1, 2, 2, 3, 4, 5][i]]} ` : ""}${ESS[i]} ${p.pp.slice(0, -1)}${e}${tail}`);
      const whole = `${v.inf}${tail}`;
      rows.push({ cells: [whole, p.aux, p.pp, say(3)[0], say(6)[0]], ex: Object.fromEntries(p.rules.map((r) => [r, `${whole} → ${say(0).join(" / ")}`])) });
      WHO.forEach((_, i) => exercises.push({ id: v.id, q: `(${WHO[i]}) ${whole}`, en: v.en, a: say(i), rules: p.rules }));
    }
    lessons.push({
      key: "passato", it: "Il passato prossimo", title: "The perfect tense: ho mangiato, sono andata", kind: "type", ask: "Passato prossimo?",
      intro: "The present of avere or essere, then the past participle. Most verbs take avere. Verbs of motion and change, and reflexive verbs, take essere, and then the participle agrees with the subject like an adjective.",
      cols: ["Verb", "Auxiliary", "Participle", "lei", "loro"], rules: RULES.passato, rows, exercises,
    });
  }

  return lessons;
}

// ── Page ─────────────────────────────────────────────────────────────────

/** JSON for a <script type="application/json"> block: `<` can't close the element. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

const ROUND = 10;

export function renderGrammar(token: string, list: GrammarWord[], key: string): string {
  const t = encodeURIComponent(token);
  const lessons = buildLessons(list);
  const lesson = lessons.find((l) => l.key === key);
  const head = (title: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
${PAGE_CSS}
${GRAMMAR_CSS}
</style></head><body><main class="grammar">
${nav(token, "grammar")}`;

  if (!lesson) {
    const cards = lessons
      .map((l) => {
        const sample = l.rows.slice(0, 3).map((r) => `<span lang="it">${esc(r.cells[0])}</span>`).join("");
        return `<a class="lesson" href="/grammar/${t}?l=${l.key}">
  <span class="it" lang="it">${esc(l.it)}</span>
  <span class="en">${esc(l.title)}</span>
  <span class="count">${l.rows.length ? `${l.rows.length} of your words` : "None of your words yet"}</span>
  ${sample ? `<span class="sample">${sample}</span>` : ""}
  <span class="best" data-best="${l.key}"></span>
</a>`;
      })
      .join("\n");
    return `${head("Grammatica")}
<h1>Grammatica</h1>
<p class="sub">Lessons built from your own words: the rules shown with them, then practice on their forms. Practice here doesn't change when words are due.</p>
<div class="lessons">
${cards}
</div>
</main>
<script>${BEST_JS}</script>
</body></html>`;
  }

  const ruleList = lesson.rules
    .map((r) => {
      const yours = lesson.rows.flatMap((row) => (row.ex[r.key] ? [row.ex[r.key]] : []));
      const ex = yours.length
        ? `<div class="ex"><span class="lbl">Your words</span>${yours.slice(0, 6).map((e) => `<span class="chip" lang="it">${esc(e)}</span>`).join("")}${yours.length > 6 ? `<span class="more">+${yours.length - 6}</span>` : ""}</div>`
        : r.stock.length
          ? `<div class="ex stock"><span class="lbl">For example</span>${r.stock.map((e) => `<span class="chip" lang="it">${esc(e)}</span>`).join("")}</div>`
          : "";
      return `<div class="rule"><div class="rt" lang="it">${esc(r.title)}</div><div class="rd"><p>${esc(r.text)}</p>${ex}</div></div>`;
    })
    .join("\n");

  const table = lesson.rows.length
    ? `<div class="scroll"><table class="forms"><thead><tr>${lesson.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
${lesson.rows
  .map((r) => `<tr>${r.cells.map((c, i) => `<td${i === r.cells.length - 1 && lesson.cols.at(-1) === "English" ? ' class="en"' : ' lang="it"'}>${esc(c)}</td>`).join("")}</tr>`)
  .join("\n")}
</tbody></table></div>`
    : `<p class="muted">None of your words fit this lesson yet. Nouns count when they're saved with their article (<i lang="it">lo schermo</i>), verbs when they're saved as the infinitive with an English “to …” (<i lang="it">cercare</i>: to look for). Add some on the <a href="/items/${t}">Words page</a>.</p>`;

  const practice = lesson.exercises.length
    ? `<section class="card practice" id="practice">
  <div id="p-intro">
    <h2>Practice</h2>
    <p class="sub">${Math.min(ROUND, lesson.exercises.length)} questions on your words${lesson.kind === "type" ? ", typed" : ""}. <span id="p-best"></span></p>
    <button type="button" class="primary" id="p-start">Start <kbd>Enter</kbd></button>
  </div>
  <div id="p-play" hidden>
    <div class="progress"><span id="p-n"></span><div class="bar"><div id="p-bar"></div></div><span id="p-score"></span></div>
    <div class="kicker">${esc(lesson.ask)}</div>
    <div class="q" id="p-q" lang="it"></div>
    <div class="gloss" id="p-en"></div>
    <div class="opts" id="p-opts" hidden></div>
    <form id="p-form" autocomplete="off" hidden>
      <input id="p-input" lang="it" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Your answer">
      <div class="accents">${["à", "è", "é", "ì", "ò", "ù"].map((a) => `<button type="button" data-ch="${a}" tabindex="-1">${a}</button>`).join("")}</div>
      <button type="submit" class="primary">Check <kbd>Enter</kbd></button>
    </form>
    <div class="result" id="p-result" hidden></div>
  </div>
  <div id="p-over" hidden>
    <h2 id="p-final"></h2>
    <div id="p-missed"></div>
    <button type="button" class="primary" id="p-again">Again <kbd>Enter</kbd></button>
  </div>
</section>`
    : "";

  return `${head(lesson.it)}
<p class="back"><a href="/grammar/${t}">← All lessons</a></p>
<h1 lang="it">${esc(lesson.it)}</h1>
<p class="sub">${esc(lesson.title)}</p>
<p class="intro">${esc(lesson.intro)}</p>
${practice}
<section class="card"><h2>The rules</h2>
${ruleList}
</section>
<section class="card"><h2>Your words</h2>
${table}
</section>
</main>
<div id="toast" hidden></div>
<script type="application/json" id="data">${scriptJson({
    key: lesson.key,
    kind: lesson.kind,
    round: ROUND,
    rules: Object.fromEntries(lesson.rules.map((r) => [r.key, `${r.title}: ${r.text}`])),
    exercises: lesson.exercises,
  })}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

const GRAMMAR_CSS = `:root{--it-green:#009246;--it-white:#f1f2ec;--it-red:#ce2b37;--ok:#11804a;--no:#c22f2f;--warn:#a06c00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--it-white:#d9dad3;--ok:#2fd28a;--no:#f0716a;--warn:#e5c14a}}
:root[data-theme="dark"]{--it-white:#d9dad3;--ok:#2fd28a;--no:#f0716a;--warn:#e5c14a}
[hidden]{display:none!important}
main.grammar{max-width:760px}
[lang=it]{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif}
kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid currentColor;border-radius:5px;padding:2px 5px;opacity:.6;margin-left:6px}
@media (hover:none){kbd{display:none}}
h1[lang=it]{font-size:28px;font-weight:600}
.back{margin:0 0 6px;font-size:14px}.back a{color:var(--ink2);text-decoration:none}
.intro{max-width:62ch;margin:6px 0 4px}
.lessons{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:8px}
.lesson{position:relative;display:flex;flex-direction:column;gap:4px;padding:18px 16px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--ring);color:var(--ink);text-decoration:none;overflow:hidden;transition:border-color .12s,transform .12s}
.lesson::before,.practice::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,var(--it-green) 0 33.4%,var(--it-white) 33.4% 66.6%,var(--it-red) 66.6%)}
.lesson:hover{border-color:var(--ink2)}.lesson:active{transform:scale(.99)}
.lesson .it{font-size:20px}.lesson .en{font-size:13px;color:var(--ink2)}
.lesson .count{font-size:12px;color:var(--muted);margin-top:6px}
.lesson .sample{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:14px;color:var(--ink2)}
.lesson .best{font-size:12px;color:var(--ok);font-weight:600}
.rule{display:grid;grid-template-columns:150px 1fr;gap:4px 16px;padding:10px 0;border-top:1px solid var(--grid)}
.rule:first-of-type{border-top:0}
.rt{font-size:17px;font-weight:600}.rd p{margin:0 0 6px}
.ex{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.ex .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.chip{font-size:15px;background:color-mix(in srgb,var(--it-green) 10%,var(--page));border:1px solid color-mix(in srgb,var(--it-green) 30%,transparent);border-radius:8px;padding:1px 8px}
.ex.stock .chip{background:var(--page);border-color:var(--grid);color:var(--ink2)}
.more{font-size:12px;color:var(--muted)}
.scroll{overflow-x:auto;margin:0 -4px}
.forms td[lang=it]{font-size:15px;font-variant-numeric:normal}.forms td:first-child{font-weight:600}
.forms td.en{color:var(--ink2)}
.practice{position:relative;overflow:hidden;padding:22px 18px 18px}
.practice h2{font-size:18px}
.primary{font:inherit;font-size:16px;font-weight:600;color:#fff;background:var(--it-green);border:1px solid var(--it-green);border-radius:12px;padding:10px 22px;cursor:pointer}
.progress{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:3px;background:var(--grid);overflow:hidden}#p-bar{height:100%;width:0;background:var(--it-green);transition:width .2s}
.kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-top:16px}
.q{font-size:clamp(24px,5vw,30px);line-height:1.2;margin:6px 0 2px}
.gloss{color:var(--ink2);margin-bottom:14px}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.opt{position:relative;font:inherit;font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:18px;text-align:left;color:var(--ink);background:var(--page);border:1.5px solid var(--base);border-radius:12px;padding:12px 12px 12px 40px;cursor:pointer}
.opt .k{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:6px;border:1px solid var(--base);display:grid;place-items:center;font:600 11px/1 system-ui,sans-serif;color:var(--muted)}
.opt:hover{border-color:var(--ink2)}.opt:disabled{cursor:default}.opt:disabled:not(.ok):not(.no){opacity:.5}
.opt.ok{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,var(--page))}
.opt.no{border-color:var(--no);background:color-mix(in srgb,var(--no) 12%,var(--page));text-decoration:line-through}
#p-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#p-input{flex:1 1 240px;font:inherit;font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:20px;color:var(--ink);background:var(--page);border:1.5px solid var(--base);border-radius:12px;padding:10px 12px}
#p-input:focus{outline:2px solid var(--s1);outline-offset:1px}
.accents{display:flex;gap:4px}
.accents button{font:inherit;font-size:16px;width:34px;height:34px;color:var(--ink);background:var(--page);border:1px solid var(--grid);border-radius:8px;cursor:pointer}
.result{margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--page);border-left:4px solid var(--base)}
.result.ok{border-left-color:var(--ok)}.result.no{border-left-color:var(--no)}.result.close{border-left-color:var(--warn)}
.result .verdict{font-weight:700}.result.ok .verdict{color:var(--ok)}.result.no .verdict{color:var(--no)}.result.close .verdict{color:var(--warn)}
.result .ans{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:19px;margin:2px 0}
.result .why{font-size:13px;color:var(--ink2);margin:6px 0 10px}
.result button{font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--base);border-radius:10px;padding:7px 14px;cursor:pointer}
#p-missed ul{list-style:none;padding:0;margin:6px 0 14px}
#p-missed li{padding:7px 0;border-top:1px solid var(--grid);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
#p-missed .q2{color:var(--ink2)}#p-missed .a2{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:17px;color:var(--ok)}
#p-missed .you{color:var(--no);text-decoration:line-through;font-size:14px}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:var(--page);padding:10px 16px;border-radius:12px;font-size:14px}
@media (max-width:560px){.rule{grid-template-columns:1fr}.opts{grid-template-columns:1fr}}
`;

// Best score per lesson, kept in this browser only.
const BEST_JS = String.raw`
(() => {
  for (const el of document.querySelectorAll("[data-best]")) {
    try {
      const b = JSON.parse(localStorage.getItem("grammar-best-" + el.dataset.best) || "null");
      if (b) el.textContent = "Best " + b.right + "/" + b.of;
    } catch (e) {}
  }
})();
`;

// Client script. Kept as String.raw with no backticks or template holes, so
// regex escapes reach the browser unchanged.
const CLIENT_JS = String.raw`
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  if (!D.exercises.length) return;
  const KEY = "grammar-best-" + D.key;
  const norm = (s) => s.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s*'\s*/g, "'").replace(/[.!?,;]+$/, "").replace(/\s+/g, " ");
  const bare = (s) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  let qs = [], i = 0, right = 0, missed = [], answered = false;

  function readBest() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function showBest() { const b = readBest(); $("p-best").textContent = b ? "Best " + b.right + "/" + b.of + "." : ""; }

  // One question per word first, so a round covers as many words as it can.
  function pick() {
    const all = shuffle(D.exercises.slice()), seen = new Set(), first = [], rest = [];
    for (const e of all) (seen.has(e.id) ? rest : first).push(e), seen.add(e.id);
    return first.concat(rest).slice(0, D.round);
  }

  function start() {
    qs = pick(); i = 0; right = 0; missed = [];
    $("p-intro").hidden = true; $("p-over").hidden = true; $("p-play").hidden = false;
    show();
  }

  function show() {
    answered = false;
    const e = qs[i];
    $("p-n").textContent = (i + 1) + " / " + qs.length;
    $("p-bar").style.width = (100 * i / qs.length) + "%";
    $("p-score").textContent = right + " right";
    $("p-q").textContent = e.q;
    $("p-en").textContent = e.en;
    $("p-result").hidden = true;
    if (D.kind === "choice") {
      const opts = $("p-opts");
      opts.hidden = false;
      opts.replaceChildren();
      e.shown = shuffle(e.opts.slice());
      e.shown.forEach((o, k) => {
        const b = el("button", "opt");
        b.type = "button";
        b.append(el("span", "k", String(k + 1)), o);
        b.addEventListener("click", () => choose(k));
        opts.append(b);
      });
    } else {
      $("p-form").hidden = false;
      const inp = $("p-input");
      inp.value = ""; inp.disabled = false;
      inp.focus({ preventScroll: true });
    }
  }

  function why(e) { return e.rules.map((r) => D.rules[r]).filter(Boolean).join(" · "); }

  function result(kind, e, you) {
    answered = true;
    const r = $("p-result");
    r.className = "result " + kind;
    r.replaceChildren();
    r.append(el("div", "verdict", kind === "ok" ? "Giusto!" : kind === "close" ? "Quasi: check the accents" : "Sbagliato"));
    if (kind !== "ok" || e.a.length > 1) r.append(el("div", "ans", e.a.join(" / ")));
    r.append(el("div", "why", why(e)));
    const next = el("button", "", i + 1 < qs.length ? "Next" : "Finish");
    next.type = "button";
    next.append(el("kbd", "", "Enter"));
    next.addEventListener("click", advance);
    r.append(next);
    r.hidden = false;
    if (kind === "ok" || kind === "close") right++;
    else missed.push({ q: e.q, a: e.a[0], you });
    $("p-score").textContent = right + " right";
    if (D.kind === "type") next.focus({ preventScroll: true });
  }

  function choose(k) {
    const e = qs[i];
    if (answered || D.kind !== "choice") return;
    const btns = Array.from($("p-opts").children);
    const ok = e.shown[k] === e.a[0];
    for (const b of btns) b.disabled = true;
    btns[e.shown.indexOf(e.a[0])].classList.add("ok");
    if (!ok) btns[k].classList.add("no");
    result(ok ? "ok" : "no", e, e.shown[k]);
  }

  function check() {
    const e = qs[i];
    const you = $("p-input").value;
    if (answered || !you.trim()) return;
    $("p-input").disabled = true;
    // A subject pronoun in front is fine: "noi cerchiamo".
    const strip = (s) => norm(s).replace(/^(io|tu|lui|lei|noi|voi|loro) /, "");
    const exact = e.a.some((a) => norm(a) === norm(you) || norm(a) === strip(you));
    const close = !exact && e.a.some((a) => bare(a) === bare(you) || bare(a) === bare(strip(you)));
    result(exact ? "ok" : close ? "close" : "no", e, you.trim());
  }

  function advance() {
    if (!answered) return;
    if (D.kind === "type") $("p-form").hidden = true;
    i++;
    if (i < qs.length) return show();
    end();
  }

  function end() {
    $("p-play").hidden = true; $("p-over").hidden = false;
    $("p-final").textContent = right + " / " + qs.length + (right === qs.length ? " · Perfetto!" : "");
    const box = $("p-missed");
    box.replaceChildren();
    if (missed.length) {
      box.append(el("p", "sub", "To look at again:"));
      const ul = el("ul");
      for (const m of missed) {
        const li = el("li");
        li.append(el("span", "q2", m.q), el("span", "a2", m.a));
        if (m.you) li.append(el("span", "you", m.you));
        ul.append(li);
      }
      box.append(ul);
    }
    const b = readBest();
    if (!b || right / qs.length > b.right / b.of) {
      try { localStorage.setItem(KEY, JSON.stringify({ right, of: qs.length })); } catch (e) {}
    }
    showBest();
    $("p-again").focus({ preventScroll: true });
  }

  $("p-start").addEventListener("click", start);
  $("p-again").addEventListener("click", start);
  $("p-form").addEventListener("submit", (ev) => { ev.preventDefault(); check(); });
  for (const b of document.querySelectorAll(".accents button")) {
    b.addEventListener("mousedown", (ev) => ev.preventDefault());
    b.addEventListener("click", () => {
      const inp = $("p-input");
      if (inp.disabled) return;
      const s = inp.selectionStart ?? inp.value.length, t = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + b.dataset.ch + inp.value.slice(t);
      inp.setSelectionRange(s + 1, s + 1);
      inp.focus();
    });
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const playing = !$("p-play").hidden;
    if (playing && D.kind === "choice" && !answered && /^[1-4]$/.test(ev.key)) { ev.preventDefault(); return choose(Number(ev.key) - 1); }
    if (ev.key !== "Enter") return;
    if (playing && answered) { ev.preventDefault(); return advance(); }
    if (!playing && !(ev.target instanceof HTMLButtonElement) && !(ev.target instanceof HTMLAnchorElement)) { ev.preventDefault(); start(); }
  });
  showBest();
})();
`;
