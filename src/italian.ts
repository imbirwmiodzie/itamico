// Italian word forms for the grammar lessons (src/lessons.ts): articles, noun
// plurals, adjective agreement and verb conjugation in every tense the lessons
// teach.
//
// Everything works from the word as saved: rules for the regular cases, tables
// for the irregular ones. A function returns null when the form can't be told
// for sure (an -ire verb that may or may not take -isc-, an -ere participle not
// in the tables, a -co plural that could go either way), and the word is then
// left out of that lesson rather than taught wrong.
//
// Where Italian allows two forms, both are kept, separated by "|": the first is
// shown, either is accepted.

export type GrammarWord = { id: number; italian: string; english: string; note: string | null };
export type Gender = "m" | "f";

const V = "aeiouàáèéìíòóùú";
export const WORD = /^[a-zàáèéìíòóùú]+$/;
export const isVowel = (c: string | undefined) => !!c && V.includes(c);
export const tidy = (s: string) => s.trim().replace(/[’`]/g, "'").replace(/\s+/g, " ").toLowerCase();
export const first = (form: string) => form.split("|")[0];
export const alts = (form: string) => form.split("|");

/** Lookup in a table of [base, value, prefixes the compounds take (null: any)], so tenere covers mantenere. */
function family<T>(table: [string, T, string[] | null][], v: string): [prefix: string, value: T] | null {
  for (const [base, value, prefixes] of table) {
    if (!v.endsWith(base)) continue;
    const prefix = v.slice(0, -base.length);
    if (prefixes ? prefixes.includes(prefix) : base !== "durre" || prefix) return [prefix, value];
  }
  return null;
}

// ── Nouns ────────────────────────────────────────────────────────────────

/**
 * A noun saved with its definite article. `tail` is whatever follows the noun
 * ("cellulare" in "il telefono cellulare", "da stiro" in "il ferro da stiro"):
 * it's carried along unchanged where the noun stays singular, and a noun with
 * a tail is left out where it would have to agree in the plural.
 */
export type Noun = { id: number; en: string; art: string; noun: string; tail: string; plural: boolean; gender: Gender | null };

/** Starts with a sound that takes lo / uno / gli: s + consonant, z, gn, ps, pn, x, y, i + vowel. */
export const loSound = (w: string) => /^(s[^aeiouàèéìòù]|z|gn|ps|pn|x|y|i[aeiouàèéìòù])/.test(w);
/** Starts with a vowel sound, h included (l'hotel). Not i + vowel, which is a consonant sound. */
export const vowelSound = (w: string) => /^h?[aeiouàèéìòù]/.test(w) && !/^h?i[aeiouàèéìòù]/.test(w);

export function definite(noun: string, g: Gender, plural: boolean): string {
  if (plural) return g === "f" ? "le" : loSound(noun) || vowelSound(noun) ? "gli" : "i";
  if (g === "f") return vowelSound(noun) ? "l'" : "la";
  return loSound(noun) ? "lo" : vowelSound(noun) ? "l'" : "il";
}

export function indefinite(noun: string, g: Gender): string {
  if (g === "f") return vowelSound(noun) ? "un'" : "una";
  return loSound(noun) ? "uno" : "un";
}

/** Two words as written: no space after an apostrophe. */
export const join = (a: string, b: string) => (a.endsWith("'") ? a + b : `${a} ${b}`);
/** The noun phrase as saved, with whatever article or determiner is put in front. */
export const np = (det: string, n: { noun: string; tail: string }) => join(det, n.noun) + (n.tail ? ` ${n.tail}` : "");

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

const NOT_NOUNS = new Set(["mio", "mia", "miei", "mie", "tuo", "tua", "tuoi", "tue", "suo", "sua", "suoi", "sue", "nostro", "nostra", "nostri", "nostre", "vostro", "vostra", "vostri", "vostre", "loro", "più", "meno", "quale", "quali"]);

/**
 * A word saved as article + noun ("lo schermo", "l'amica", "le chiavi",
 * "il telefono cellulare"), with its gender. Null for anything else, or when
 * the article doesn't follow the rules (so an exception is never taught as one).
 */
export function parseNoun(w: GrammarWord): Noun | null {
  const s = tidy(w.italian);
  const m = s.match(/^(il|lo|la|i|gli|le) (\S+)(?: (.+))?$/) ?? s.match(/^(l')(\S+)(?: (.+))?$/);
  if (!m || !WORD.test(m[2]) || NOT_NOUNS.has(m[2]) || ![...m[2]].some((c) => isVowel(c))) return null;
  const [, art, noun] = m;
  const tail = m[3] ?? "";
  if (tail.split(" ").length > 3 || !/^[a-zàáèéìíòóùú' ]*$/.test(tail)) return null;
  const plural = art === "i" || art === "gli" || art === "le";
  const gender: Gender | null = art === "l'" ? elidedGender(noun, w.note) : art === "la" || art === "le" ? "f" : "m";
  if (gender ? definite(noun, gender, plural) !== art : !vowelSound(noun)) return null;
  return { id: w.id, en: w.english, art, noun, tail, plural, gender };
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

export type Plural = { art: string; noun: string; gender: Gender; rule: string };

/** The plural of a singular noun with its article, or null when it can't be told for sure. */
export function pluralOf(n: Noun): Plural | null {
  if (n.plural || !n.gender || n.tail) return null;
  const w = n.noun;
  const out = (noun: string, rule: string, g: Gender = n.gender!): Plural => ({ art: definite(noun, g, true), noun, gender: g, rule });
  const irr = IRREGULAR_PL[w];
  if (irr) return w === "dio" ? { art: "gli", noun: "dei", gender: "m", rule: "irr" } : out(irr[0], "irr", irr[1]);
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

/** The noun in the plural, from a plural word as saved or a singular one made plural. */
export function asPlural(n: Noun): { art: string; noun: string; gender: Gender; tail: string } | null {
  if (n.plural) return n.gender && { art: n.art, noun: n.noun, gender: n.gender, tail: n.tail };
  const p = pluralOf(n);
  return p && { ...p, tail: "" };
}

// Family nouns: no article with a singular possessive (mia madre), except loro.
export const FAMILY = new Set(["madre", "padre", "fratello", "sorella", "figlio", "figlia", "marito", "moglie", "zio", "zia", "cugino", "cugina", "nonno", "nonna", "suocero", "suocera", "cognato", "cognata", "genero", "nuora"]);

// ── Adjectives ───────────────────────────────────────────────────────────

export type Adjective = { id: number; en: string; m: string; forms: [ms: string, fs: string, mp: string, fp: string] };

const INV_ADJ = new Set(["rosa", "viola", "blu", "beige", "lilla", "ocra", "pari", "dispari", "perbene", "fucsia", "crema", "bordeaux"]);
// Common English adjectives, to tell a bare Italian adjective from an adverb or a noun saved without its article.
const EN_ADJ = new Set(`big small little tired happy sad angry hungry thirsty cold hot warm cool new old young good bad nice beautiful ugly pretty fast slow quick easy hard
difficult cheap expensive rich poor full empty clean dirty wet dry long short tall high low wide narrow thick thin heavy light dark bright loud quiet sick ill
healthy strong weak brave shy lazy busy free safe ready sure true false right wrong late early open closed broken sweet sour bitter salty spicy fresh ripe raw
soft rough smooth sharp deep shallow huge tiny fat slim proud polite rude kind mean calm nervous worried scared afraid bored funny serious strange weird normal
real fake fine glad upset jealous red blue green yellow white black grey gray brown pink purple orange round square flat steep crowded famous foreign local
main whole single same different clever smart stupid silly crazy wise sweet tender gentle fierce wild tame loose tight rare common simple complex plain fancy
lucky unlucky alone lonely friendly cosy cozy messy tidy neat sleepy dizzy pale fit fair modern ancient elegant grumpy greedy generous honest stubborn tough cute`.split(/\s+/));
const NOT_ADJ = new Set(["presto", "tardi", "subito", "spesso", "molto", "poco", "troppo", "tanto", "piano", "bene", "male", "sempre", "mai", "insieme", "ancora",
  "quasi", "dove", "come", "quando", "perché", "oggi", "ieri", "domani", "adesso", "ora", "allora", "dopo", "prima", "sopra", "sotto", "dentro", "fuori",
  "davanti", "dietro", "vicino", "lontano", "forse", "proprio", "appena", "abbastanza", "purtroppo", "inoltre", "infatti", "quindi", "comunque", "anche",
  "neanche", "nemmeno", "così", "già", "più", "meno", "niente", "nulla", "nessuno", "qualcuno", "ognuno", "tutto", "questo", "quello", "stesso", "altro",
  "uno", "ciao", "grazie", "prego", "salve", "esatto", "ecco", "invece", "almeno", "perfino", "persino", "apposta", "ovunque", "altrove", "laggiù", "lassù"]);

const syllables = (w: string) => (w.match(/[aeiouàáèéìíòóùú]+/g) ?? []).length;

/** Masculine and feminine, singular and plural, from the masculine singular. Null when unsure. */
export function adjectiveForms(m: string): Adjective["forms"] | null {
  if (INV_ADJ.has(m)) return [m, m, m, m];
  if (m.endsWith("ista")) return [m, m, m.slice(0, -1) + "i", m.slice(0, -1) + "e"];
  if (m.endsWith("e")) return [m, m, m.slice(0, -1) + "i", m.slice(0, -1) + "i"];
  if (!m.endsWith("o")) return null;
  const b = m.slice(0, -1);
  let mp: string;
  if (/logo$/.test(m)) return null;
  if (m.endsWith("co")) {
    const soft = m.endsWith("ico") ? syllables(m) >= 3 && !["antico", "carico", "scarico"].includes(m) : ["greco", "porco", "amico", "nemico"].includes(m);
    mp = b + (soft ? "i" : "hi");
  } else if (m.endsWith("go")) mp = b + "hi";
  else if (m.endsWith("io")) mp = /[aeiou]io$/.test(m) || m.length <= 3 ? b + "i" : b;
  else mp = b + "i";
  let fp: string;
  const fs = b + "a";
  const cia = fs.match(/(.)([cg])ia$/);
  if (/[cg]a$/.test(fs)) fp = b + "he";
  else if (cia) fp = fs.slice(0, -2) + (isVowel(cia[1]) ? "ie" : "e");
  else fp = b + "e";
  return [m, fs, mp, fp];
}

/**
 * A word saved as a bare adjective ("stanco", "felice"): one Italian word, an
 * English gloss that reads as an adjective (or a note that says adjective).
 * Saved in the feminine ("stanca"), it's taken back to the masculine.
 */
export function parseAdjective(w: GrammarWord): Adjective | null {
  const s = tidy(w.italian);
  const note = w.note ?? "";
  if (!WORD.test(s) || NOT_ADJ.has(s) || /mente$/.test(s) || /\b(noun|sostantiv|adverb|avverb|verb)/i.test(note)) return null;
  const en = w.english.toLowerCase().replace(/\(.*?\)/g, "").replace(/^(very|quite|a bit|rather|so)\s+/, "").trim();
  const saysAdj = /\b(adj|aggettiv)/i.test(note);
  if (!saysAdj) {
    if (/^(to|the|a|an)\s/.test(en) || /ly$/.test(en) || /(are|ere|ire)$/.test(s)) return null;
    const words = en.split(/[\s,/;]+/).filter(Boolean);
    if (words.length > 2 || !words.some((x) => EN_ADJ.has(x) || (x.length >= 5 && /(ful|ous|ive|able|ible|less|ish|ed|ic|al|ant|ent|ary|ular)$/.test(x)))) return null;
  }
  const m = s.endsWith("a") && !s.endsWith("ista") && !INV_ADJ.has(s) ? s.slice(0, -1) + "o" : s;
  const forms = adjectiveForms(m);
  return forms && { id: w.id, en: w.english, m, forms };
}

/** Absolute superlative (stanchissimo), from the masculine plural. */
export function issimo(a: Adjective): Adjective["forms"] | null {
  const [ms, , mp] = a.forms;
  if (ms === mp || ms.endsWith("ista")) return null;
  const b = mp.slice(0, -1) + "issim";
  return [b + "o", b + "a", b + "i", b + "e"];
}

// buono → migliore: irregular comparatives and superlatives (the regular ones are fine too).
export const IRR_COMPARATIVE: Record<string, { comp: string; sup: string }> = {
  buono: { comp: "migliore", sup: "ottimo" },
  cattivo: { comp: "peggiore", sup: "pessimo" },
  grande: { comp: "maggiore", sup: "massimo" },
  piccolo: { comp: "minore", sup: "minimo" },
};

// ── Verbs ────────────────────────────────────────────────────────────────

export type Verb = { id: number; en: string; inf: string; base: string; rest: string; refl: boolean };

// Reflexives of trarre: distrarsi → distrarre, but mostrarsi → mostrare.
const TRARRE = new Set(["trar", "distrar", "sottrar", "ritrar", "attrar", "estrar"]);

/** A word saved as an infinitive, maybe with more after it ("fare la spesa", "alzarsi"). */
export function parseVerb(w: GrammarWord): Verb | null {
  if (!/^to\s/i.test(w.english.trim()) && !/\bverb/i.test(w.note ?? "")) return null;
  const [head, ...rest] = tidy(w.italian).split(" ");
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

export const PERSONS = ["io", "tu", "lui/lei", "noi", "voi", "loro"];
export const REFL = ["mi", "ti", "si", "ci", "vi", "si"];
/** The seven subjects for compound tenses, where lui and lei differ, and their person 0-5. */
export const WHO = ["io", "tu", "lui", "lei", "noi", "voi", "loro"];
export const WHO_PERSON = [0, 1, 2, 2, 3, 4, 5];
const AGREE = [["o", "a"], ["o", "a"], ["o"], ["a"], ["i", "e"], ["i", "e"], ["i", "e"]];

// Compounds that don't follow fare, dare, stare or andare as written (rifà, ridò), or
// whose forms vary (soddisfo, soddisfaccio): left out where that matters.
const UNSURE = (v: string) => (v.endsWith("fare") && v !== "fare") || ["ridare", "sottostare", "soprastare", "ristare", "riandare"].includes(v);
const DIRE = ["", "ri", "dis", "contrad", "bene", "male", "pre"];

// Irregular presents.
const IRR_PRESENT: [string, string, string[] | null][] = [
  ["essere", "sono sei è siamo siete sono", [""]],
  ["avere", "ho hai ha abbiamo avete hanno", [""]],
  ["andare", "vado vai va andiamo andate vanno", [""]],
  ["fare", "faccio fai fa facciamo fate fanno", [""]],
  ["dare", "do dai dà diamo date danno", [""]],
  ["stare", "sto stai sta stiamo state stanno", [""]],
  ["dire", "dico dici dice diciamo dite dicono", DIRE],
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

/** The imperfect's stem with its vowel: parla-, prende-, dormi-, and face-, dice-, beve-… */
function imperfectStem(v: string): string {
  const f = family<string>([["fare", "face", null], ["dire", "dice", DIRE], ["bere", "beve", [""]], ["porre", "pone", null], ["durre", "duce", null], ["trarre", "trae", null]], v);
  return f ? f[0] + f[1] : v.slice(0, -2);
}

/** Imperfetto: parlavo, prendevo, dormivo. Regular for nearly every verb. */
export function imperfectOf(v: string): Conjugation {
  if (v === "essere") return { forms: ["ero", "eri", "era", "eravamo", "eravate", "erano"], rules: ["irr"] };
  const s = imperfectStem(v);
  return { forms: ["vo", "vi", "va", "vamo", "vate", "vano"].map((e) => s + e), rules: [s === v.slice(0, -2) ? "reg" : "irr"] };
}

/** Congiuntivo imperfetto: parlassi, prendessi, dormissi. */
export function subjImperfectOf(v: string): Conjugation {
  const special: Record<string, string> = { essere: "fo", dare: "de", stare: "ste" };
  const s = special[v] ?? imperfectStem(v);
  return { forms: ["ssi", "ssi", "sse", "ssimo", "ste", "ssero"].map((e) => s + e), rules: [special[v] || s !== v.slice(0, -2) ? "irr" : "reg"] };
}

/** Gerundio: parlando, prendendo, dormendo. */
export function gerundOf(v: string): string {
  const s = imperfectStem(v);
  return s.endsWith("i") ? s.slice(0, -1) + "endo" : s + "ndo";
}

const IRR_FUTURE: [string, string, string[] | null][] = [
  ["essere", "sar", [""]], ["avere", "avr", [""]], ["andare", "andr", [""]], ["dovere", "dovr", [""]], ["potere", "potr", [""]],
  ["sapere", "sapr", [""]], ["vedere", "vedr", ["", "ri", "pre", "intra"]], ["vivere", "vivr", ["", "soprav", "con", "ri"]],
  ["cadere", "cadr", ["", "ac", "de", "ri"]], ["godere", "godr", [""]], ["venire", "verr", null], ["volere", "vorr", [""]],
  ["tenere", "terr", null], ["rimanere", "rimarr", [""]], ["bere", "berr", [""]], ["valere", "varr", ["", "pre", "equi"]],
  ["parere", "parr", [""]], ["dolere", "dorr", [""]], ["porre", "porr", null], ["durre", "durr", null], ["trarre", "trarr", null],
  ["fare", "far", null], ["dare", "dar", [""]], ["stare", "star", [""]],
];

/** The stem of the future and the conditional: parler-, cercher-, manger-, prender-, and sar-, avr-, verr-… */
function futureStem(v: string): { stem: string; rule: string } {
  const irr = family(IRR_FUTURE, v);
  if (irr) return { stem: irr[0] + irr[1], rule: "irr" };
  if (!v.endsWith("are")) return { stem: v.slice(0, -1), rule: "reg" };
  const s = v.slice(0, -3);
  if (/[cg]$/.test(s)) return { stem: s + "her", rule: "care" };
  if (/[cg]i$/.test(s) && !STRESSED_IARE.has(v)) return { stem: s.slice(0, -1) + "er", rule: "ciare" };
  return { stem: s + "er", rule: "reg" };
}

export function futureOf(v: string): Conjugation {
  const { stem, rule } = futureStem(v);
  return { forms: ["ò", "ai", "à", "emo", "ete", "anno"].map((e) => stem + e), rules: [rule] };
}

export function conditionalOf(v: string): Conjugation {
  const { stem, rule } = futureStem(v);
  return { forms: ["ei", "esti", "ebbe", "emmo", "este", "ebbero"].map((e) => stem + e), rules: [rule] };
}

/** Congiuntivo presente: parli, prenda, dorma, finisca; vada, faccia, venga… */
export function subjunctiveOf(v: string): Conjugation | null {
  const special: Record<string, string> = {
    essere: "sia sia sia siamo siate siano",
    avere: "abbia abbia abbia abbiamo abbiate abbiano",
    sapere: "sappia sappia sappia sappiamo sappiate sappiano",
    dare: "dia dia dia diamo diate diano",
    stare: "stia stia stia stiamo stiate stiano",
    dovere: "debba|deva debba|deva debba|deva dobbiamo dobbiate debbano|devano",
  };
  if (special[v]) return { forms: special[v].split(" "), rules: ["irr"] };
  const p = presentOf(v);
  if (!p) return null;
  const noi = p.forms[3], voi = noi.replace(/iamo$/, "iate");
  if (p.rules[0] === "irr") {
    // From the io form: vengo → venga, faccio → faccia, esco → esca.
    const io = p.forms[0];
    if (!io.endsWith("o")) return null;
    const s = io.slice(0, -1);
    return { forms: [s + "a", s + "a", s + "a", noi, voi, s + "ano"], rules: ["irr"] };
  }
  const stem = v.slice(0, -3);
  if (v.endsWith("are")) {
    const sg = stem.endsWith("i") && !STRESSED_IARE.has(v) ? stem : stem + (/[cg]$/.test(stem) ? "hi" : "i");
    return { forms: [sg, sg, sg, noi, voi, sg + "no"], rules: ["are"] };
  }
  const sg = stem + (p.rules[0] === "isc" ? "isca" : "a");
  return { forms: [sg, sg, sg, noi, voi, sg + "no"], rules: [p.rules[0] === "isc" ? "isc" : "ere"] };
}

export type Imperative = { tu: string; noi: string; voi: string; lei: string; neg: string; rules: string[] };

const IMP_TU: Record<string, string> = { andare: "va'|vai", dare: "da'|dai", fare: "fa'|fai", stare: "sta'|stai", dire: "di'", essere: "sii", avere: "abbi", sapere: "sappi" };
const IMP_VOI: Record<string, string> = { essere: "siate", avere: "abbiate", sapere: "sappiate" };

/** Imperative for tu, noi, voi and the polite Lei, and the negative tu (non + infinitive), pronouns attached. */
export function imperativeOf(vb: Verb): Imperative | null {
  const v = vb.base;
  if (["dovere", "potere", "volere", "parere", "giacere"].includes(v)) return null;
  if (vb.refl && IMP_TU[v]) return null; // fatti, dimmi: the doubled consonant isn't worth guessing
  const p = presentOf(v), s = subjunctiveOf(v);
  if (!p || !s) return null;
  const tu = IMP_TU[v] ?? (v.endsWith("are") && p.rules[0] !== "irr" ? p.forms[2] : p.forms[1]);
  const voi = IMP_VOI[v] ?? p.forms[4];
  const tail = vb.rest ? ` ${vb.rest}` : "";
  const att = (f: string, pron: string) => alts(f).map((x) => x + pron).join("|");
  if (vb.refl) {
    const inf = vb.base.slice(0, -1);
    return {
      tu: att(tu, "ti") + tail, noi: att(p.forms[3], "ci") + tail, voi: att(voi, "vi") + tail, lei: `si ${s.forms[2]}` + tail,
      neg: `non ${inf}ti${tail}|non ti ${vb.base}${tail}`, rules: ["refl", ...(IMP_TU[v] || IMP_VOI[v] ? ["irr"] : [])],
    };
  }
  return {
    tu: tu.split("|").map((x) => x + tail).join("|"), noi: p.forms[3] + tail, voi: voi + tail,
    lei: alts(s.forms[2]).map((x) => x + tail).join("|"), neg: `non ${v}${tail}`,
    rules: IMP_TU[v] || IMP_VOI[v] ? ["irr"] : [v.endsWith("are") ? "are" : "ere"],
  };
}

// Irregular passato remoto (the 1-3-3 pattern): [base, [strong stem, weak stem], prefixes].
// prendere: presi, prendesti, prese, prendemmo, prendeste, presero.
const IRR_REMOTE: [string, [string, string], string[] | null][] = [
  ["avere", ["ebb", "ave"], [""]], ["fare", ["fec", "face"], null], ["dire", ["diss", "dice"], DIRE], ["venire", ["venn", "veni"], null],
  ["tenere", ["tenn", "tene"], null], ["volere", ["voll", "vole"], [""]], ["sapere", ["sepp", "sape"], [""]], ["vedere", ["vid", "vede"], ["", "ri", "pre"]],
  ["bere", ["bevv", "beve"], [""]], ["prendere", ["pres", "prende"], null], ["mettere", ["mis", "mette"], null], ["scrivere", ["scriss", "scrive"], null],
  ["leggere", ["less", "legge"], ["", "ri", "e"]], ["chiudere", ["chius", "chiude"], null], ["cludere", ["clus", "clude"], null],
  ["chiedere", ["chies", "chiede"], ["", "ri"]], ["rispondere", ["rispos", "risponde"], ["", "cor"]], ["conoscere", ["conobb", "conosce"], ["", "ri"]],
  ["nascere", ["nacqu", "nasce"], ["", "ri"]], ["piacere", ["piacqu", "piace"], ["", "dis", "com"]], ["tacere", ["tacqu", "tace"], [""]],
  ["giacere", ["giacqu", "giace"], [""]], ["rimanere", ["rimas", "rimane"], [""]], ["gliere", ["ls", "glie"], null], ["cidere", ["cis", "cide"], null],
  ["ridere", ["ris", "ride"], ["", "sor", "de"]], ["videre", ["vis", "vide"], null], ["correre", ["cors", "corre"], null],
  ["vivere", ["viss", "vive"], ["", "soprav", "con", "ri"]], ["perdere", ["pers", "perde"], [""]], ["rompere", ["rupp", "rompe"], null],
  ["cadere", ["cadd", "cade"], ["", "ac", "de"]], ["muovere", ["moss", "muove"], null], ["piangere", ["pians", "piange"], ["", "rim"]],
  ["pingere", ["pins", "pinge"], null], ["fingere", ["fins", "finge"], [""]], ["vincere", ["vins", "vince"], null], ["spegnere", ["spens", "spegne"], [""]],
  ["accendere", ["acces", "accende"], [""]], ["scendere", ["sces", "scende"], null], ["pendere", ["pes", "pende"], null], ["tendere", ["tes", "tende"], null],
  ["fendere", ["fes", "fende"], null], ["rendere", ["res", "rende"], null], ["succedere", ["success", "succede"], [""]],
  ["concedere", ["conces", "concede"], [""]], ["crescere", ["crebb", "cresce"], null], ["cuocere", ["coss", "cuoce"], ["", "ri"]],
  ["porre", ["pos", "pone"], null], ["durre", ["duss", "duce"], null], ["trarre", ["trass", "trae"], null], ["ungere", ["uns", "unge"], null],
  ["primere", ["press", "prime"], null], ["stinguere", ["stins", "stingue"], null], ["sumere", ["suns", "sume"], null], ["solvere", ["sols", "solve"], null],
  ["volgere", ["vols", "volge"], null], ["torcere", ["tors", "torce"], null], ["porgere", ["pors", "porge"], [""]], ["sorgere", ["sors", "sorge"], ["", "ri"]],
  ["accorgere", ["accors", "accorge"], [""]], ["scorgere", ["scors", "scorge"], [""]], ["mergere", ["mers", "merge"], null], ["mordere", ["mors", "morde"], [""]],
  ["nascondere", ["nascos", "nasconde"], [""]], ["cutere", ["cuss", "cute"], null], ["valere", ["vals", "vale"], ["", "pre"]], ["parere", ["parv", "pare"], [""]],
  ["apparire", ["apparv", "appari"], [""]], ["comparire", ["comparv", "compari"], ["", "s"]],
];

/** Passato remoto: parlai, credei, dormii, and the irregular presi, feci, venni… */
export function remoteOf(v: string): Conjugation | null {
  const special: Record<string, string> = {
    essere: "fui fosti fu fummo foste furono",
    dare: "diedi|detti desti diede|dette demmo deste diedero|dettero",
    stare: "stetti stesti stette stemmo steste stettero",
  };
  if (special[v]) return { forms: special[v].split(" "), rules: ["irr"] };
  const irr = family(IRR_REMOTE, v);
  if (irr) {
    const [p, [s, w]] = irr;
    return { forms: [p + s + "i", p + w + "sti", p + s + "e", p + w + "mmo", p + w + "ste", p + s + "ero"], rules: ["irr"] };
  }
  const x = v.slice(0, -3);
  if (v.endsWith("are")) return { forms: ["ai", "asti", "ò", "ammo", "aste", "arono"].map((e) => x + e), rules: ["are"] };
  if (v.endsWith("ire")) return { forms: ["ii", "isti", "ì", "immo", "iste", "irono"].map((e) => x + e), rules: ["ire"] };
  if (v.endsWith("ere") && REGULAR_ERE.has(v)) {
    return { forms: [`${x}ei|${x}etti`, `${x}esti`, `${x}é|${x}ette`, `${x}emmo`, `${x}este`, `${x}erono|${x}ettero`], rules: ["ere"] };
  }
  return null;
}

// Irregular participles.
const IRR_PARTICIPLE: [string, string, string[] | null][] = [
  ["essere", "stato", [""]], ["stare", "stato", [""]], ["fare", "fatto", ["", "ri"]],
  ["dire", "detto", DIRE], ["venire", "venuto", null], ["porre", "posto", null],
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
// -ere verbs whose participle (and passato remoto) is regular. Other -ere verbs are left out of those.
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

/** The past participle alone, for verbs whose participle is certain. */
export function participleOf(v: string): { pp: string; rule: string } | null {
  const irr = family(IRR_PARTICIPLE, v);
  if (irr) return { pp: irr[0] + irr[1], rule: "irr" };
  if (UNSURE(v)) return null;
  const stem = v.slice(0, -3);
  if (v.endsWith("are")) return { pp: stem + "ato", rule: "pp" };
  if (v.endsWith("ire")) return { pp: stem + "ito", rule: "pp" };
  if (v.endsWith("ere") && REGULAR_ERE.has(v)) return { pp: stem + "uto", rule: "pp" };
  return null;
}

export type Perfect = { aux: "avere" | "essere"; pp: string; rules: string[] };

/** Auxiliary and participle for the compound tenses, or null when unsure. */
export function perfectOf(v: string, refl: boolean): Perfect | null {
  if (!refl && EITHER.has(v)) return null;
  const aux = refl || ESSERE.has(v) ? "essere" : "avere";
  const p = participleOf(v);
  return p && { aux, pp: p.pp, rules: [refl ? "refl" : aux, p.rule] };
}

/** Avere and essere in each simple tense, for building the compound ones. */
export const AUX = {
  presente: { avere: presentOf("avere")!.forms, essere: presentOf("essere")!.forms },
  imperfetto: { avere: imperfectOf("avere").forms, essere: imperfectOf("essere").forms },
  futuro: { avere: futureOf("avere").forms, essere: futureOf("essere").forms },
  condizionale: { avere: conditionalOf("avere").forms, essere: conditionalOf("essere").forms },
  congiuntivo: { avere: subjunctiveOf("avere")!.forms, essere: subjunctiveOf("essere")!.forms },
  congImperfetto: { avere: subjImperfectOf("avere").forms, essere: subjImperfectOf("essere").forms },
};
export type AuxTense = keyof typeof AUX;

/**
 * A compound tense for one of the seven subjects (WHO): the auxiliary in
 * `tense`, then the participle, which agrees with the subject after essere
 * (both genders accepted for io, tu, noi, voi and loro).
 */
export function compound(vb: Verb, p: Perfect, tense: AuxTense, who: number, between = ""): string[] {
  const i = WHO_PERSON[who];
  const aux = AUX[tense][p.aux][i];
  const tail = vb.rest ? ` ${vb.rest}` : "";
  const mid = between ? ` ${between}` : "";
  if (p.aux === "avere") return [`${aux}${mid} ${p.pp}${tail}`];
  return AGREE[who].map((e) => `${vb.refl ? `${REFL[i]} ` : ""}${aux}${mid} ${p.pp.slice(0, -1)}${e}${tail}`);
}

/** A simple tense's forms for a verb as saved: reflexive pronouns in front, the rest of the phrase after. */
export function phrase(vb: Verb, forms: string[]): string[] {
  const tail = vb.rest ? ` ${vb.rest}` : "";
  return forms.map((f, i) => alts(f).map((x) => (vb.refl ? `${REFL[i]} ${x}` : x) + tail).join("|"));
}

/** The infinitive as saved, with the rest of the phrase. */
export const whole = (vb: Verb) => vb.inf + (vb.rest ? ` ${vb.rest}` : "");
