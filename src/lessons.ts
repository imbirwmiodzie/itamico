// The grammar lessons, each worked out on the words in the list. A lesson has
// rules (with your words as their examples where some fit), a table of your
// words' forms, and exercises asking for those forms. The Grammar page
// (src/grammar.ts) shows them; the tutor drills them by voice through the
// get_grammar tool.
//
// Forms come from src/italian.ts, which leaves a word out wherever its form
// isn't certain. Sentence frames ("Penso che…", "Se avessi tempo…") are fixed;
// the words that go in them are yours.

import {
  type Adjective, adjectiveForms, alts, asPlural, compound, conditionalOf, FAMILY, first, futureOf, type GrammarWord, gerundOf,
  imperativeOf, imperfectOf, indefinite, IRR_COMPARATIVE, issimo, join, loSound, type Noun, np, PERSONS, parseAdjective, parseNoun,
  parseVerb, perfectOf, phrase, pluralOf, presentOf, REFL, remoteOf, subjImperfectOf, subjunctiveOf, type Verb, vowelSound, WHO,
  WHO_PERSON, whole,
} from "./italian.js";

export type Exercise = {
  id: number;
  /** The prompt; ___ marks the gap. */
  q: string;
  en: string;
  /** Accepted answers, the first being the one shown. */
  a: string[];
  /** Choices to pick from; none means the answer is typed (or said). */
  opts?: string[];
  rules: string[];
  /** The whole sentence or phrase with the answer in it, shown after answering. */
  full?: string;
};
export type Rule = { key: string; title: string; text: string; stock: string[] };
/** One of your words in a lesson: its forms, and an example for each rule it shows. */
export type Row = { cells: string[]; ex: Record<string, string> };
export type Lesson = {
  key: string;
  group: string;
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

export const GROUPS = ["Nomi e articoli", "Aggettivi", "Preposizioni e pronomi", "Presente e passato", "Futuro, modi e forme", "La frase"];

const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** A stable pick for a word, so a word's examples don't change on every load. */
const pick = <T>(list: readonly T[], id: number, k = 0): T => list[(id * 7 + k * 3) % list.length];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const choices = (right: string, all: string[]) => [right, ...shuffle([...new Set(all)].filter((o) => o !== right)).slice(0, 3)];
const exOf = (rules: string[], text: string) => Object.fromEntries(rules.map((r) => [r, text]));
const show = (form: string) => alts(form).join(" / ");
const tailOf = (vb: Verb) => (vb.rest ? ` ${vb.rest}` : "");
/** Preposition or demonstrative + article: di + il = del, que + gli = quegli. */
export const merge = (base: string, art: string) =>
  base + ({ il: "l", lo: "llo", la: "lla", "l'": "ll'", i: "i", gli: "gli", le: "lle" } as Record<string, string>)[art];
const PREPS = [["di", "de"], ["a", "a"], ["da", "da"], ["in", "ne"], ["su", "su"]] as const;
/** The participle agreeing: o, a, i, e for m/f singular/plural. */
const agree = (pp: string, g: "m" | "f", plural: boolean) => pp.slice(0, -1) + (plural ? (g === "f" ? "e" : "i") : g === "f" ? "a" : "o");

type Words = { nouns: Noun[]; verbs: Verb[]; adjs: Adjective[] };
type Built = Pick<Lesson, "rows" | "exercises">;
type Def = Omit<Lesson, "rows" | "exercises"> & { build: (w: Words) => Built };

// ── Nouns and articles ───────────────────────────────────────────────────

const articoli: Def = {
  key: "articoli", group: GROUPS[0], it: "Gli articoli", title: "The definite article: il, lo, la, l', i, gli, le", kind: "choice", ask: "Which article?",
  intro: "Every noun has a gender, and the article shows it. Which article you need depends on the gender, on singular or plural, and on the sound the noun starts with. The surest way to know a noun's gender is to learn it with its article, which is how your words are saved.",
  cols: ["Word", "English"],
  rules: [
    { key: "il", title: "il", text: "Masculine, before most consonants.", stock: ["il libro", "il treno"] },
    { key: "lo", title: "lo", text: "Masculine, before s + consonant, z, gn, ps, pn, x, y and i + vowel.", stock: ["lo zaino", "lo studente", "lo gnomo"] },
    { key: "l'", title: "l'", text: "Before a vowel (or a silent h), masculine or feminine: lo and la drop their vowel.", stock: ["l'albero", "l'amica", "l'hotel"] },
    { key: "la", title: "la", text: "Feminine, before a consonant, and before i + vowel.", stock: ["la casa", "la strada"] },
    { key: "i", title: "i", text: "Masculine plural, for the words that take il.", stock: ["i libri", "i treni"] },
    { key: "gli", title: "gli", text: "Masculine plural, for the words that take lo or l'.", stock: ["gli zaini", "gli alberi"] },
    { key: "le", title: "le", text: "Feminine plural, always. It isn't elided: le amiche.", stock: ["le case", "le amiche"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const word = np(n.art, n);
      rows.push({ cells: [word, n.en], ex: { [n.art]: word } });
      exercises.push({ id: n.id, q: `___ ${n.noun}${n.tail ? ` ${n.tail}` : ""}`, en: n.en, a: [n.art], opts: n.plural ? ["i", "gli", "le"] : ["il", "lo", "la", "l'"], rules: [n.art], full: word });
    }
    return { rows, exercises };
  },
};

const un: Def = {
  key: "un", group: GROUPS[0], it: "Un, uno, una, un'", title: "The indefinite article", kind: "choice", ask: "Which article?",
  intro: "The indefinite article (a, an) follows the same sounds as the definite one: uno where you'd say lo, una where you'd say la. The trap is the apostrophe: it's only for feminine words (un'amica), never masculine ones (un amico).",
  cols: ["Word", "Indefinite", "English"],
  rules: [
    { key: "un", title: "un", text: "Masculine, before a consonant and also before a vowel, without an apostrophe.", stock: ["un libro", "un amico"] },
    { key: "uno", title: "uno", text: "Masculine, before the sounds that take lo: s + consonant, z, gn, ps, x, y.", stock: ["uno zaino", "uno studente"] },
    { key: "una", title: "una", text: "Feminine, before a consonant.", stock: ["una casa", "una strada"] },
    { key: "un'", title: "un'", text: "Feminine, before a vowel: here the apostrophe is needed.", stock: ["un'amica", "un'isola"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      if (n.plural || !n.gender) continue;
      const art = indefinite(n.noun, n.gender), word = np(art, n);
      rows.push({ cells: [np(n.art, n), word, n.en], ex: { [art]: word } });
      exercises.push({ id: n.id, q: `___ ${n.noun}${n.tail ? ` ${n.tail}` : ""}`, en: n.en, a: [art], opts: ["un", "uno", "una", "un'"], rules: [art], full: word });
    }
    return { rows, exercises };
  },
};

const plurale: Def = {
  key: "plurale", group: GROUPS[0], it: "Il plurale", title: "Plurals, article included", kind: "type", ask: "Plurale?",
  intro: "The ending of a noun changes in the plural, and so does its article. Most words follow the first three rules; the rest are about keeping the sound of c and g, and the words that never change.",
  cols: ["Singular", "Plural", "English"],
  rules: [
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
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const p = pluralOf(n);
      if (!p) continue;
      const sg = join(n.art, n.noun), pl = join(p.art, p.noun);
      const rules = [p.rule, ...(n.art === "lo" || n.art === "l'" ? ["art"] : [])];
      rows.push({ cells: [sg, pl, n.en], ex: exOf(rules, `${sg} → ${pl}`) });
      exercises.push({ id: n.id, q: sg, en: n.en, a: [pl], rules });
    }
    return { rows, exercises };
  },
};

const dimostrativi: Def = {
  key: "dimostrativi", group: GROUPS[0], it: "Questo e quello", title: "Demonstratives: this and that", kind: "choice", ask: "Which is right?",
  intro: "Questo (this) is a plain adjective: questo, questa, questi, queste. Quello (that) changes like the definite article, because it ends in one: quel like il, quello like lo, quell' like l', and so on.",
  cols: ["Word", "questo", "quello", "Plural"],
  rules: [
    { key: "questo", title: "questo", text: "questo, questa, questi, queste. Before a vowel the singular may drop its vowel: quest'amica.", stock: ["questo libro", "questa casa", "queste chiavi"] },
    { key: "quel", title: "quel, quei", text: "Where the article is il and i.", stock: ["quel libro", "quei libri"] },
    { key: "quello", title: "quello, quegli", text: "Where the article is lo and gli: before s + consonant, z, gn, ps, and quegli before vowels too.", stock: ["quello zaino", "quegli zaini", "quegli alberi"] },
    { key: "quell'", title: "quell'", text: "Where the article is l'.", stock: ["quell'albero", "quell'amica"] },
    { key: "quella", title: "quella, quelle", text: "Where the article is la and le.", stock: ["quella casa", "quelle case"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    const quelRule = (art: string) => ({ il: "quel", i: "quel", lo: "quello", gli: "quello", "l'": "quell'", la: "quella", le: "quella" })[art]!;
    for (const n of nouns) {
      const forms: { art: string; noun: string; tail: string; plural: boolean; g: "m" | "f" | null }[] = [{ ...n, g: n.gender }];
      const p = !n.plural ? asPlural(n) : null;
      if (p) forms.push({ ...p, plural: true, g: p.gender });
      const cells: string[] = [np(n.art, n)];
      const ex: Record<string, string> = {};
      for (const f of forms) {
        const arts = f.plural ? ["i", "gli", "le"] : ["il", "lo", "l'", "la"];
        const quel = np(merge("que", f.art), f);
        exercises.push({ id: n.id, q: `(quello) ${f.noun}${f.tail ? ` ${f.tail}` : ""}`, en: n.en, a: [quel], opts: choices(quel, arts.map((a) => np(merge("que", a), f))), rules: [quelRule(f.art)] });
        ex[quelRule(f.art)] ??= quel;
        if (f.g) {
          const q = f.plural ? (f.g === "f" ? "queste" : "questi") : f.g === "f" ? "questa" : "questo";
          const right = np(q, f);
          const a = !f.plural && vowelSound(f.noun) ? [right, np("quest'", f)] : [right];
          exercises.push({ id: n.id, q: `(questo) ${f.noun}${f.tail ? ` ${f.tail}` : ""}`, en: n.en, a, opts: choices(right, ["questo", "questa", "questi", "queste"].map((x) => np(x, f))), rules: ["questo"] });
          ex.questo ??= right;
        }
      }
      const sg = forms[0];
      cells.push(sg.g ? np(sg.plural ? (sg.g === "f" ? "queste" : "questi") : sg.g === "f" ? "questa" : "questo", sg) : "", np(merge("que", sg.art), sg), p ? np(merge("que", p.art), p) : "");
      rows.push({ cells, ex });
    }
    return { rows, exercises };
  },
};

const POSS: Record<string, [string, string, string, string]> = {
  io: ["mio", "mia", "miei", "mie"], tu: ["tuo", "tua", "tuoi", "tue"], "lui/lei": ["suo", "sua", "suoi", "sue"],
  noi: ["nostro", "nostra", "nostri", "nostre"], voi: ["vostro", "vostra", "vostri", "vostre"], loro: ["loro", "loro", "loro", "loro"],
};

const possessivi: Def = {
  key: "possessivi", group: GROUPS[0], it: "I possessivi", title: "Possessives: il mio, la tua, i nostri…", kind: "type", ask: "Possessivo?",
  intro: "A possessive agrees with the thing owned, not with the owner: la mia chiave, i miei amici, whoever I am. It normally takes the article too. The exception is a single family member: mia madre, tuo fratello, with no article.",
  cols: ["Word", ...PERSONS],
  rules: [
    { key: "forms", title: "The forms", text: "mio, mia, miei, mie; tuo, tua, tuoi, tue; suo, sua, suoi, sue; nostro…; vostro…; loro never changes.", stock: ["il mio libro", "la sua casa", "i tuoi amici"] },
    { key: "art", title: "With the article", text: "il mio, la mia, i miei, le mie. The article follows the noun's gender and number, never lo or l'.", stock: ["il mio zaino", "la tua amica"] },
    { key: "suo", title: "suo = his, her and your (Lei)", text: "suo agrees with the thing: la sua chiave is his key or her key.", stock: ["il suo libro", "la sua macchina"] },
    { key: "fam", title: "Family, singular", text: "No article: mia madre, suo fratello. It comes back in the plural (i miei fratelli), with loro (la loro madre), and with mamma and papà.", stock: ["mia sorella", "i miei fratelli", "la loro madre"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      if (!n.gender) continue;
      const g = n.gender === "f" ? 1 : 0;
      const k = g + (n.plural ? 2 : 0);
      const cells = [np(n.art, n)];
      const ex: Record<string, string> = {};
      PERSONS.forEach((who) => {
        const poss = POSS[who][k];
        const fam = FAMILY.has(n.noun) && !n.plural && !n.tail && who !== "loro";
        const art = n.plural ? (n.gender === "f" ? "le" : "i") : n.gender === "f" ? "la" : "il";
        const form = fam ? np(poss, n) : np(`${art} ${poss}`, n);
        const rules = fam ? ["fam"] : who === "lui/lei" ? ["art", "suo"] : ["art"];
        exercises.push({ id: n.id, q: `(${who}) ${np(n.art, n)}`, en: n.en, a: [form], rules: ["forms", ...rules] });
        cells.push(form);
        for (const r of rules) ex[r] ??= form;
      });
      rows.push({ cells, ex });
    }
    return { rows, exercises };
  },
};

// ── Adjectives ───────────────────────────────────────────────────────────

const SUBJECTS: [subject: string, form: number][] = [["Marco è", 0], ["Giulia è", 1], ["Marco e Luca sono", 2], ["Giulia e Anna sono", 3], ["Giulia e Marco sono", 2]];

const adjClass = (a: Adjective) => {
  const [ms, fs, mp] = a.forms;
  if (ms === mp) return "inv";
  if (ms.endsWith("ista")) return "ista";
  if (ms === fs) return "e";
  return /[cg]o$/.test(ms) ? "co" : "o";
};

const aggettivi: Def = {
  key: "aggettivi", group: GROUPS[1], it: "Gli aggettivi", title: "Adjectives agree: stanco, stanca, stanchi, stanche", kind: "type", ask: "Which form?",
  intro: "An adjective takes the gender and number of what it describes. Adjectives in -o have four forms, adjectives in -e only two. A mixed group of men and women takes the masculine plural.",
  cols: ["Adjective", "m. sing.", "f. sing.", "m. plur.", "f. plur.", "English"],
  rules: [
    { key: "o", title: "-o: four forms", text: "-o, -a, -i, -e.", stock: ["alto, alta, alti, alte"] },
    { key: "e", title: "-e: two forms", text: "-e for both genders in the singular, -i in the plural.", stock: ["felice, felici", "verde, verdi"] },
    { key: "co", title: "-co, -go", text: "Spelling as for nouns: the h keeps the hard sound in -chi, -ghi, -che, -ghe; most -ico adjectives go soft in the masculine (simpatici).", stock: ["stanco, stanchi, stanche", "lungo, lunghi", "simpatico, simpatici, simpatiche"] },
    { key: "ista", title: "-ista", text: "One singular for both genders, then -isti and -iste.", stock: ["ottimista, ottimisti, ottimiste"] },
    { key: "inv", title: "Unchanged", text: "Some colours (rosa, viola, blu, beige) and a few others never change.", stock: ["le scarpe blu", "i fiori rosa"] },
    { key: "mixed", title: "Mixed group", text: "Men and women together: masculine plural.", stock: ["Giulia e Marco sono stanchi"] },
    { key: "bello", title: "bello, buono, grande before a noun", text: "Before the noun, bello goes like the article (bel, bello, bell', bei, begli), buono like un (buon, buono, buon'), and grande may become gran.", stock: ["un bel giorno", "un buon amico", "una gran fame"] },
  ],
  build: ({ adjs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const a of adjs) {
      const cls = adjClass(a);
      rows.push({ cells: [a.m, ...a.forms, a.en], ex: { [cls]: [...new Set(a.forms)].join(", ") } });
      SUBJECTS.forEach(([subj, k], i) => {
        const rules = i === 4 ? [cls, "mixed"] : [cls];
        exercises.push({ id: a.id, q: `${subj} ___ (${a.m})`, en: a.en, a: [a.forms[k]], rules, full: `${subj} ${a.forms[k]}.` });
      });
    }
    return { rows, exercises };
  },
};

const comparativi: Def = {
  key: "comparativi", group: GROUPS[1], it: "Comparativi e superlativi", title: "più alto di, il più alto, altissimo", kind: "type", ask: "Complete it.",
  intro: "Più (more) and meno (less) go before the adjective, and di before what you compare with. The superlative is the article + più: il più alto. -issimo makes very: altissimo. The adjective still agrees.",
  cols: ["Adjective", "more", "the most", "very"],
  rules: [
    { key: "piu", title: "più … di", text: "More than: Giulia è più alta di Anna. Di merges with an article: più alto del fratello.", stock: ["più alto di", "più stanca di"] },
    { key: "meno", title: "meno … di", text: "Less than.", stock: ["meno caro di"] },
    { key: "come", title: "come, tanto … quanto", text: "As … as: alto come, tanto alto quanto, così alto come.", stock: ["alta come", "tanto alto quanto"] },
    { key: "rel", title: "il più, la più", text: "The most: article + più (+ di for the group): la più alta della classe.", stock: ["il più alto", "la più stanca"] },
    { key: "abs", title: "-issimo", text: "Very: the masculine plural minus -i, + -issimo, -issima, -issimi, -issime.", stock: ["stanchissimo", "felicissima", "lunghissimi"] },
    { key: "irr", title: "Irregular", text: "buono → migliore, ottimo; cattivo → peggiore, pessimo; grande → maggiore, massimo; piccolo → minore, minimo. The regular forms are fine too.", stock: ["migliore di", "il migliore", "ottimo"] },
  ],
  build: ({ adjs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const a of adjs) {
      const sup = issimo(a);
      const irr = IRR_COMPARATIVE[a.m];
      const [ms, fs, mp, fp] = a.forms;
      // buono: migliore first, but più buono is fine too.
      const irrForms = irr && adjectiveForms(irr.comp)!;
      const comp = (k: number) => (irrForms ? [irrForms[k], `più ${a.forms[k]}`] : [`più ${a.forms[k]}`]);
      const art = ["il", "la", "i", "le"];
      const ex: Record<string, string> = { piu: `più ${ms} di`, rel: `il più ${ms}` };
      const push = (q: string, ans: string[], rules: string[], full: string) => exercises.push({ id: a.id, q, en: a.en, a: ans, rules, full });
      push(`Giulia è ___ di Anna (+ ${ms})`, comp(1), irr ? ["piu", "irr"] : ["piu"], `Giulia è ${comp(1)[0]} di Anna.`);
      push(`Marco e Luca sono ___ di Paolo (+ ${ms})`, comp(2), irr ? ["piu", "irr"] : ["piu"], `Marco e Luca sono ${comp(2)[0]} di Paolo.`);
      push(`Marco è ___ di Luca (− ${ms})`, [`meno ${ms}`], ["meno"], `Marco è meno ${ms} di Luca.`);
      push(`Giulia e Anna sono ___ Paolo (= ${ms})`, [`${fp} come`, `tanto ${fp} quanto`, `così ${fp} come`], ["come"], `Giulia e Anna sono ${fp} come Paolo.`);
      [1, 2].forEach((k) => {
        const subj = k === 1 ? "Giulia è" : "Marco e Luca sono";
        const ans = comp(k).map((c) => `${art[k]} ${c}`);
        push(`${subj} ___ della classe (the most, ${ms})`, ans, irr ? ["rel", "irr"] : ["rel"], `${subj} ${ans[0]} della classe.`);
      });
      if (sup) {
        ex.abs = sup[0];
        [3, 0].forEach((k) => {
          const subj = k === 3 ? "Giulia e Anna sono" : "Marco è";
          const ans = [sup[k], ...(irr ? [adjectiveForms(irr.sup)![k]] : [])];
          push(`${subj} ___ (very ${ms}, -issimo)`, ans, irr ? ["abs", "irr"] : ["abs"], `${subj} ${sup[k]}.`);
        });
      }
      if (irr) ex.irr = `${ms} → ${irr.comp}, ${irr.sup}`;
      rows.push({ cells: [ms, `più ${ms} di`, `il più ${ms}`, sup ? sup[0] : ""], ex });
    }
    return { rows, exercises };
  },
};

// ── Prepositions and pronouns ────────────────────────────────────────────

const preposizioni: Def = {
  key: "preposizioni", group: GROUPS[2], it: "Le preposizioni articolate", title: "di, a, da, in, su + the article", kind: "choice", ask: "Which is right?",
  intro: "Five prepositions merge with the definite article into one word: in + il = nel, di + la = della. The ending copies the article, with a double l where the article starts with l (dello, della, dell', delle).",
  cols: ["Word", "di", "a", "da", "in", "su"],
  rules: [
    ...PREPS.map(([p, b]) => ({
      key: p, title: p,
      text: ["il", "lo", "la", "l'", "i", "gli", "le"].map((a) => `${p} + ${a} = ${merge(b, a)}`).join(", ") + ".",
      stock: [`${merge(b, "il")} treno`, `${merge(b, "gli")} amici`],
    })),
    { key: "other", title: "con, per, tra, fra", text: "These stay apart from the article: con il treno, per la strada, tra gli amici.", stock: [] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const forms: { art: string; noun: string; tail: string; plural: boolean }[] = [n];
      const p = !n.plural && asPlural(n);
      if (p) forms.push({ ...p, plural: true });
      const merged = PREPS.map(([, b]) => np(merge(b, n.art), n));
      rows.push({ cells: [np(n.art, n), ...merged], ex: Object.fromEntries(PREPS.map(([pr], i) => [pr, merged[i]])) });
      for (const f of forms) {
        const arts = f.plural ? ["i", "gli", "le"] : ["il", "lo", "la", "l'"];
        for (const [prep, b] of PREPS) {
          const right = np(merge(b, f.art), f);
          const wrong = arts.filter((a) => a !== f.art).map((a) => np(merge(b, a), f));
          if (f.plural) wrong.push(`${prep} ${np(f.art, f)}`);
          exercises.push({ id: n.id, q: `${prep} + ${np(f.art, f)}`, en: n.en, a: [right], opts: choices(right, wrong), rules: [prep] });
        }
      }
    }
    return { rows, exercises };
  },
};

const DIR_VERBS = [["cerco", "cercato"], ["vedo", "visto"], ["prendo", "preso"], ["trovo", "trovato"], ["porto", "portato"], ["conosco", "conosciuto"]] as const;
const IND_VERBS = ["porto", "mando", "mostro", "presento", "descrivo", "passo"] as const;
const RECIPIENTS = [["a me", "me"], ["a te", "te"], ["a Marco", "glie"], ["a Giulia", "glie"], ["a noi", "ce"], ["a voi", "ve"]] as const;
const dirPron = (g: "m" | "f", plural: boolean) => (plural ? (g === "f" ? "le" : "li") : g === "f" ? "la" : "lo");
const combo = (ind: string, dir: string) => (ind === "glie" ? `glie${dir}` : `${ind} ${dir}`);

const pronomi: Def = {
  key: "pronomi", group: GROUPS[2], it: "I pronomi", title: "Object pronouns: lo vedo, gli parlo, glielo do", kind: "type", ask: "Use a pronoun.",
  intro: "Object pronouns go before the conjugated verb. Direct ones replace the thing (lo, la, li, le), indirect ones the person you give or say it to (mi, ti, gli, le, ci, vi). Together they make one block: me lo, te la, glielo.",
  cols: ["Word", "direct", "with avere", "combined"],
  rules: [
    { key: "dir", title: "lo, la, li, le", text: "The thing, before the verb: lo cerco, la vedo, li prendo, le compro.", stock: ["lo cerco", "le compro"] },
    { key: "pp", title: "With avere", text: "lo and la become l' before ho, hai, ha…, and the participle agrees with the pronoun: l'ho vista, li ho presi, le ho comprate.", stock: ["l'ho visto", "l'ho vista", "le ho comprate"] },
    { key: "ind", title: "mi, ti, gli, le, ci, vi, gli", text: "The person: a me = mi, a te = ti, a lui = gli, a lei = le, a noi = ci, a voi = vi, a loro = gli (or loro after the verb).", stock: ["gli scrivo", "le telefono", "mi dici"] },
    { key: "comb", title: "me lo, te lo, glielo", text: "Indirect + direct: mi, ti, ci, vi become me, te, ce, ve; gli and le both become glie-, joined to the next: glielo, gliela, glieli, gliele.", stock: ["te lo do", "glielo porto", "ce le mandano"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const forms: { art: string; noun: string; tail: string; plural: boolean; g: "m" | "f" }[] = [];
      if (n.gender) forms.push({ ...n, g: n.gender });
      const p = !n.plural && asPlural(n);
      if (p) forms.push({ ...p, plural: true, g: p.gender });
      if (!forms.length) continue;
      const cells: string[] = [np(n.art, n)];
      const ex: Record<string, string> = {};
      forms.forEach((f, fi) => {
        const obj = np(f.art, f);
        const pron = dirPron(f.g, f.plural);
        const [v, pp] = pick(DIR_VERBS, n.id, fi);
        const d = `${pron} ${v}`;
        exercises.push({ id: n.id, q: `${cap(v)} ${obj}.`, en: n.en, a: [d], rules: ["dir"], full: `${cap(d)}.` });
        const withAvere = `${f.plural ? `${pron} ho` : "l'ho"} ${agree(pp, f.g, f.plural)}`;
        exercises.push({ id: n.id, q: `Ho ${pp} ${obj}.`, en: n.en, a: [withAvere], rules: ["pp"], full: `${cap(withAvere)}.` });
        const iv = pick(IND_VERBS, n.id, fi);
        const [to, ind] = pick(RECIPIENTS, n.id, fi + 1);
        const c = `${combo(ind, pron)} ${iv}`;
        exercises.push({ id: n.id, q: `${cap(iv)} ${obj} ${to}.`, en: n.en, a: [c], rules: ["comb"], full: `${cap(c)}.` });
        if (fi === 0) {
          cells.push(d, withAvere, c);
          Object.assign(ex, { dir: d, pp: withAvere, comb: c });
        }
      });
      rows.push({ cells, ex });
    }
    return { rows, exercises };
  },
};

const cine: Def = {
  key: "cine", group: GROUPS[2], it: "Ci e ne", title: "ci penso, ne parlo, ne ho tre", kind: "type", ask: "Use ci or ne.",
  intro: "Ci replaces a + something (and places: there). Ne replaces di + something, and a quantity: how many of it. Both go before the verb, like the other pronouns.",
  cols: ["Word", "a …", "di …", "quantity"],
  rules: [
    { key: "ci", title: "ci = a + something", text: "Penso allo schermo → ci penso. Also there: vado a Roma → ci vado.", stock: ["ci penso", "ci vado", "ci tengo"] },
    { key: "ne", title: "ne = di + something", text: "Parlo del film → ne parlo. Ho bisogno di tempo → ne ho bisogno.", stock: ["ne parlo", "ne ho bisogno"] },
    { key: "neq", title: "ne + a quantity", text: "The number or amount stays, the noun goes: ho tre chiavi → ne ho tre; molti, molte agree with it.", stock: ["ne ho tre", "ne vedo molte"] },
    { key: "nepp", title: "ne with avere", text: "The participle agrees with what ne stands for: ne ho viste tre (chiavi).", stock: ["ne ho visti due", "ne ho comprate tre"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const ci = "ci penso", ne = "ne parlo";
      exercises.push({ id: n.id, q: `Penso ${np(merge("a", n.art), n)}.`, en: n.en, a: [ci], rules: ["ci"], full: "Ci penso." });
      exercises.push({ id: n.id, q: `Tengo molto ${np(merge("a", n.art), n)}.`, en: n.en, a: ["ci tengo molto"], rules: ["ci"], full: "Ci tengo molto." });
      exercises.push({ id: n.id, q: `Parlo ${np(merge("de", n.art), n)}.`, en: n.en, a: [ne], rules: ["ne"], full: "Ne parlo." });
      exercises.push({ id: n.id, q: `Ho bisogno ${np(merge("de", n.art), n)}.`, en: n.en, a: ["ne ho bisogno"], rules: ["ne"], full: "Ne ho bisogno." });
      const p = asPlural(n);
      let q = "";
      if (p && !p.tail) {
        const many = p.gender === "f" ? "molte" : "molti";
        const seen = agree("visto", p.gender, true);
        q = "ne ho tre";
        exercises.push({ id: n.id, q: `Ho tre ${p.noun}.`, en: n.en, a: [q], rules: ["neq"], full: "Ne ho tre." });
        exercises.push({ id: n.id, q: `Vedo ${many} ${p.noun}.`, en: n.en, a: [`ne vedo ${many}`], rules: ["neq"], full: `Ne vedo ${many}.` });
        const pp = `ne ho ${seen} due`;
        exercises.push({ id: n.id, q: `Ho visto due ${p.noun}.`, en: n.en, a: [pp], rules: ["nepp"], full: `${cap(pp)}.` });
      }
      rows.push({ cells: [np(n.art, n), `Penso ${np(merge("a", n.art), n)} → ci penso`, `Parlo ${np(merge("de", n.art), n)} → ne parlo`, p && !p.tail ? `Ho tre ${p.noun} → ne ho tre` : ""], ex: { ci: `ci penso (${np(merge("a", n.art), n)})`, ne: `ne parlo (${np(merge("de", n.art), n)})`, ...(q ? { neq: `ne ho tre (${p!.noun})` } : {}) } });
    }
    return { rows, exercises };
  },
};

// {N} is the noun phrase, {è} is or are, {era} was or were.
// After a preposition cui and il quale are both right: each exercise accepts the other too.
const REL_FRAMES: { s: string; a: string; rule: string; prep?: string }[] = [
  { s: "Dov'{è} {n} ___ {era} qui?", a: "che", rule: "che" },
  { s: "{N} ___ cerchi {è} qui.", a: "che", rule: "che" },
  { s: "{N} ___ ti ho parlato {è} qui.", a: "di cui", rule: "cui", prep: "de" },
  { s: "{N} ___ penso spesso {è} qui.", a: "a cui", rule: "cui", prep: "a" },
  { s: "{N} ___ hai bisogno {è} qui.", a: "di cui", rule: "cui", prep: "de" },
  { s: "{N} ___ ti ho parlato {è} qui.", a: "di cui", rule: "quale", prep: "de" },
  { s: "{N} ___ penso spesso {è} qui.", a: "a cui", rule: "quale", prep: "a" },
];

const relativi: Def = {
  key: "relativi", group: GROUPS[2], it: "I pronomi relativi", title: "che, cui, il quale", kind: "choice", ask: "Which relative pronoun?",
  intro: "Che (who, which, that) joins a clause where the noun is the subject or the object. After a preposition it becomes cui (di cui, a cui, in cui), or il quale, which agrees with the noun and merges with the preposition: del quale, alla quale.",
  cols: ["Word", "che", "di cui", "il quale"],
  rules: [
    { key: "che", title: "che", text: "Subject or object, never after a preposition: lo schermo che vedi.", stock: ["il libro che leggo", "la ragazza che parla"] },
    { key: "cui", title: "preposition + cui", text: "di cui, a cui, con cui, in cui, per cui: the preposition the verb needs (parlare di, pensare a).", stock: ["il film di cui parlo", "l'amica a cui penso"] },
    { key: "quale", title: "il quale, la quale, i quali, le quali", text: "Instead of cui, more formal; it agrees with the noun and merges with the preposition: del quale, della quale, ai quali.", stock: ["il libro del quale ti ho parlato", "le amiche alle quali penso"] },
  ],
  build: ({ nouns }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const forms: { art: string; noun: string; tail: string; plural: boolean; g: "m" | "f" | null }[] = [{ ...n, g: n.gender }];
      const p = !n.plural && asPlural(n);
      if (p) forms.push({ ...p, plural: true, g: p.gender });
      for (const f of forms) {
        const fill = (s: string) =>
          s.replace("{N}", cap(np(f.art, f))).replace("{n}", np(f.art, f)).replace("Dov'{è}", f.plural ? "Dove sono" : "Dov'è")
            .replace("{è}", f.plural ? "sono" : "è").replace("{era}", f.plural ? "erano" : "era");
        for (const fr of REL_FRAMES) {
          const gap = fill(fr.s);
          const qual = (art: string) => `${merge(fr.prep!, art)} ${art === "i" || art === "le" ? "quali" : "quale"}`;
          const quale = fr.prep && f.g ? qual(f.plural ? (f.g === "f" ? "le" : "i") : f.g === "f" ? "la" : "il") : "";
          if (fr.rule === "quale" && !quale) continue;
          const a = fr.rule === "quale" ? [quale, fr.a] : [fr.a, ...(quale ? [quale] : [])];
          const opts = fr.rule === "quale" ? ["il", "la", "i", "le"].map(qual) : ["che", "di cui", "a cui", "in cui"];
          exercises.push({ id: n.id, q: gap, en: n.en, a, opts: choices(a[0], opts), rules: [fr.rule], full: gap.replace("___", a[0]) });
        }
      }
      const s = cap(np(n.art, n)), g = n.gender;
      const qa = n.plural ? (g === "f" ? "delle quali" : "dei quali") : g === "f" ? "della quale" : "del quale";
      rows.push({
        cells: [np(n.art, n), `${s} che cerchi`, `${s} di cui ti ho parlato`, g ? `${s} ${qa} ti ho parlato` : ""],
        ex: { che: `${s} che cerchi`, cui: `${s} di cui ti ho parlato`, ...(g ? { quale: `${s} ${qa} ti ho parlato` } : {}) },
      });
    }
    return { rows, exercises };
  },
};

// [to whom, pronoun, reflexive pronoun for an infinitive after it]
const LIKERS = [["a me", "mi", "mi"], ["a te", "ti", "ti"], ["a Marco", "gli", "si"], ["a Giulia", "le", "si"], ["a noi", "ci", "ci"], ["a voi", "vi", "vi"], ["a loro", "gli", "si"]] as const;

const piacere: Def = {
  key: "piacere", group: GROUPS[2], it: "Piacere", title: "mi piace, mi piacciono", kind: "type", ask: "Say who likes it.",
  intro: "With piacere, the thing liked is the subject and the person is an indirect pronoun: mi piace lo schermo is 'the screen pleases me'. So the verb agrees with the thing: piace for one thing or an infinitive, piacciono for several.",
  cols: ["Word", "a me", "a Giulia", "past"],
  rules: [
    { key: "sg", title: "piace", text: "One thing, or a verb in the infinitive: mi piace il mare, mi piace nuotare.", stock: ["mi piace il caffè", "ci piace viaggiare"] },
    { key: "pl", title: "piacciono", text: "Several things: ti piacciono le fragole?", stock: ["mi piacciono i gatti"] },
    { key: "pron", title: "mi, ti, gli, le, ci, vi, gli", text: "a me = mi, a te = ti, a lui = gli, a lei = le, a noi = ci, a voi = vi, a loro = gli. A noun stays with a: a Marco piace.", stock: ["gli piace", "le piacciono"] },
    { key: "pp", title: "In the past", text: "Essere, and the participle agrees with the thing liked: mi è piaciuto il film, mi sono piaciute le foto.", stock: ["mi è piaciuta la pizza", "ci sono piaciuti i film"] },
  ],
  build: ({ nouns, verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const obj = np(n.art, n);
      const verb = n.plural ? "piacciono" : "piace";
      LIKERS.forEach(([to, pron], i) => {
        if (i % 2 && i !== 3) return; // a sample of persons per word: me, Marco, Giulia, noi, loro
        exercises.push({ id: n.id, q: `(${to}) ${obj}`, en: n.en, a: [`${pron} ${verb} ${obj}`], rules: [n.plural ? "pl" : "sg", "pron"] });
      });
      let past = "";
      if (n.gender) {
        const [to, pron] = pick(LIKERS, n.id);
        past = `${pron} ${n.plural ? "sono" : "è"} ${agree("piaciuto", n.gender, n.plural)} ${obj}`;
        exercises.push({ id: n.id, q: `(${to}, ieri) ${obj}`, en: n.en, a: [past], rules: ["pp"] });
      }
      rows.push({ cells: [obj, `mi ${verb} ${obj}`, `le ${verb} ${obj}`, past], ex: { [n.plural ? "pl" : "sg"]: `mi ${verb} ${obj}`, pron: `le ${verb} ${obj}`, ...(past ? { pp: past } : {}) } });
    }
    for (const vb of verbs) {
      const inf = (r: string) => (vb.refl ? vb.inf.slice(0, -2) + r : vb.inf) + tailOf(vb);
      LIKERS.forEach(([to, pron, r], i) => {
        if (i % 3) return;
        exercises.push({ id: vb.id, q: `(${to}) ${whole(vb)}`, en: vb.en, a: [`${pron} piace ${inf(r)}`], rules: ["sg", "pron"] });
      });
      rows.push({ cells: [whole(vb), `mi piace ${inf("mi")}`, `le piace ${inf("si")}`, ""], ex: { sg: `mi piace ${inf("mi")}` } });
    }
    return { rows, exercises };
  },
};

// ── Present and past ─────────────────────────────────────────────────────

const REFL_RULE = { key: "refl", title: "Reflexive", text: "-arsi, -ersi, -irsi: mi, ti, si, ci, vi, si before the verb.", stock: ["alzarsi: mi alzo, ti alzi, si alza…"] };

/** A lesson that conjugates each verb in one simple tense: rows of six forms, one exercise per person. */
function tenseLesson(def: Omit<Def, "build" | "cols"> & { conj: (vb: Verb) => { forms: string[]; rules: string[] } | null; label?: string }): Def {
  return {
    ...def,
    cols: ["Verb", ...PERSONS],
    build: ({ verbs }) => {
      const rows: Row[] = [], exercises: Exercise[] = [];
      for (const vb of verbs) {
        const c = def.conj(vb);
        if (!c) continue;
        const forms = phrase(vb, c.forms);
        const rules = vb.refl ? ["refl", ...c.rules] : c.rules;
        rows.push({ cells: [whole(vb), ...forms.map(show)], ex: exOf(rules, `${whole(vb)}: ${forms.slice(0, 3).map(first).join(", ")}…`) });
        forms.forEach((f, i) => exercises.push({ id: vb.id, q: `(${PERSONS[i]}) ${whole(vb)}${def.label ? ` · ${def.label}` : ""}`, en: vb.en, a: alts(f), rules }));
      }
      return { rows, exercises };
    },
  };
}

const presente = tenseLesson({
  key: "presente", group: GROUPS[3], it: "Il presente", title: "The present tense", kind: "type", ask: "Presente?",
  intro: "Drop -are, -ere or -ire and add the ending for the person. The three groups differ only in a few endings; the rest is spelling (cerchi, mangi) and the irregular verbs, which happen to be the most common ones.",
  rules: [
    { key: "are", title: "-are", text: "-o, -i, -a, -iamo, -ate, -ano.", stock: ["parlare: parlo, parli, parla, parliamo, parlate, parlano"] },
    { key: "ere", title: "-ere", text: "-o, -i, -e, -iamo, -ete, -ono.", stock: ["prendere: prendo, prendi, prende, prendiamo, prendete, prendono"] },
    { key: "ire", title: "-ire", text: "-o, -i, -e, -iamo, -ite, -ono.", stock: ["dormire: dormo, dormi, dorme, dormiamo, dormite, dormono"] },
    { key: "isc", title: "-ire with -isc-", text: "Many -ire verbs add -isc- except for noi and voi: -isco, -isci, -isce, -iamo, -ite, -iscono.", stock: ["capire: capisco, capisci, capisce, capiamo, capite, capiscono"] },
    { key: "care", title: "-care, -gare", text: "Add h before i to keep the hard sound: cerchi, paghiamo.", stock: ["cercare: cerco, cerchi, cerca, cerchiamo…"] },
    { key: "iare", title: "-iare", text: "No double i: mangi, studiamo. Only a stressed i stays: invii.", stock: ["mangiare: mangio, mangi, mangia, mangiamo…"] },
    { key: "irr", title: "Irregular", text: "Learn these by heart; their compounds follow them (tenere → mantenere).", stock: ["andare: vado, vai, va, andiamo, andate, vanno"] },
    REFL_RULE,
  ],
  conj: (vb) => presentOf(vb.base),
});

/** A lesson asking one compound form per subject, for each verb with a known auxiliary and participle. */
const passato: Def = {
  key: "passato", group: GROUPS[3], it: "Il passato prossimo", title: "The perfect tense: ho mangiato, sono andata", kind: "type", ask: "Passato prossimo?",
  intro: "The present of avere or essere, then the past participle. Most verbs take avere. Verbs of motion and change, and reflexive verbs, take essere, and then the participle agrees with the subject like an adjective.",
  cols: ["Verb", "Auxiliary", "Participle", "lei", "loro"],
  rules: [
    { key: "avere", title: "avere + participle", text: "Most verbs. The participle stays in -o: ho mangiato, abbiamo mangiato.", stock: ["ho mangiato", "abbiamo visto"] },
    { key: "essere", title: "essere + participle", text: "Verbs of motion and change (andare, venire, partire, nascere, diventare), and piacere. The participle agrees like an adjective: è andata, siamo andati.", stock: ["sono andata", "siamo partiti"] },
    { key: "refl", title: "Reflexive verbs", text: "Always essere, with the pronoun first: mi sono alzata.", stock: ["mi sono alzato", "si sono vestite"] },
    { key: "pp", title: "Regular participles", text: "-are → -ato, -ere → -uto, -ire → -ito.", stock: ["parlare → parlato", "dormire → dormito"] },
    { key: "irr", title: "Irregular participles", text: "Mostly -ere verbs; compounds follow them (prendere → preso, sorprendere → sorpreso).", stock: ["fare → fatto", "prendere → preso", "mettere → messo"] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const p = perfectOf(vb.base, vb.refl);
      if (!p) continue;
      const say = (w: number) => compound(vb, p, "presente", w);
      rows.push({ cells: [whole(vb), p.aux, p.pp, say(3)[0], say(6)[0]], ex: exOf(p.rules, `${whole(vb)} → ${say(0).join(" / ")}`) });
      WHO.forEach((who, w) => exercises.push({ id: vb.id, q: `(${who}) ${whole(vb)}`, en: vb.en, a: say(w), rules: p.rules }));
    }
    return { rows, exercises };
  },
};

const imperfetto = tenseLesson({
  key: "imperfetto", group: GROUPS[3], it: "L'imperfetto", title: "The imperfect: parlavo, prendevo, dormivo", kind: "type", ask: "Imperfetto?",
  intro: "The imperfect is the most regular tense in Italian: take the infinitive, drop -re, add -vo, -vi, -va, -vamo, -vate, -vano. It describes how things were and what used to happen, as the background to the events.",
  rules: [
    { key: "reg", title: "-vo, -vi, -va, -vamo, -vate, -vano", text: "On the infinitive minus -re: parla-vo, prende-vo, dormi-vo, capi-vo (no -isc-).", stock: ["parlavo", "prendevamo", "dormivano"] },
    { key: "irr", title: "Irregular", text: "essere: ero, eri, era, eravamo, eravate, erano. fare → facevo, dire → dicevo, bere → bevevo, porre → ponevo, tradurre → traducevo.", stock: ["ero", "facevo", "dicevi"] },
    REFL_RULE,
  ],
  conj: (vb) => imperfectOf(vb.base),
});

const PP_FRAMES = ["Ieri sera", "Sabato scorso", "All'improvviso", "Due anni fa", "Stamattina", "Una volta"];
const IMP_FRAMES = ["Da giovane, ogni estate,", "Di solito, a quei tempi,", "Tutti i giorni, allora,", "Mentre pioveva,", "Ogni mattina, da piccoli,", "Spesso, a vent'anni,"];

const ppimperfetto: Def = {
  key: "ppimperfetto", group: GROUPS[3], it: "Passato prossimo o imperfetto?", title: "Events and background", kind: "type", ask: "Which past?",
  intro: "Both are past. The passato prossimo tells what happened: one event, finished, often with a time (ieri, una volta, all'improvviso). The imperfetto describes how things were: habits, states, and what was going on when something happened (di solito, ogni giorno, mentre).",
  cols: ["Verb", "passato prossimo", "imperfetto"],
  rules: [
    { key: "pp", title: "Passato prossimo: the event", text: "Something that happened and finished: ieri, sabato scorso, due anni fa, all'improvviso, una volta.", stock: ["Ieri ho mangiato la pizza.", "All'improvviso è arrivata."] },
    { key: "imp", title: "Imperfetto: the background", text: "Habits (di solito, ogni giorno), descriptions, and what was going on (mentre…): da piccolo giocavo a calcio.", stock: ["Di solito mangiavo alle otto.", "Mentre dormivo, è suonato il telefono."] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const p = perfectOf(vb.base, vb.refl);
      if (!p) continue;
      const imp = phrase(vb, imperfectOf(vb.base).forms);
      WHO.forEach((who, w) => {
        const pf = pick(PP_FRAMES, vb.id, w), imf = pick(IMP_FRAMES, vb.id, w);
        const a = compound(vb, p, "presente", w);
        exercises.push({ id: vb.id, q: `${pf}, (${who}) ___ (${whole(vb)})`, en: vb.en, a, rules: ["pp"], full: `${pf}, ${a[0]}.` });
        const b = alts(imp[WHO_PERSON[w]]);
        exercises.push({ id: vb.id, q: `${imf} (${who}) ___ (${whole(vb)})`, en: vb.en, a: b, rules: ["imp"], full: `${imf} ${b[0]}.` });
      });
      const a0 = compound(vb, p, "presente", 0)[0], b0 = first(imp[0]);
      rows.push({ cells: [whole(vb), `ieri ${a0}`, `di solito ${b0}`], ex: { pp: `Ieri ${a0}.`, imp: `Di solito ${b0}.` } });
    }
    return { rows, exercises };
  },
};

const remoto = tenseLesson({
  key: "remoto", group: GROUPS[3], it: "Il passato remoto", title: "The remote past: parlai, credei, dormii", kind: "type", ask: "Passato remoto?",
  intro: "The passato remoto tells events long past, and it's the tense of stories and history books; in the south it's used in speech too. Regular verbs are easy; many -ere verbs are irregular, but only in three forms (io, lui/lei, loro), always built on the same strong stem.",
  rules: [
    { key: "are", title: "-are", text: "-ai, -asti, -ò, -ammo, -aste, -arono.", stock: ["parlai, parlasti, parlò, parlammo, parlaste, parlarono"] },
    { key: "ere", title: "-ere", text: "-ei (-etti), -esti, -é (-ette), -emmo, -este, -erono (-ettero).", stock: ["credei, credesti, credé, credemmo, credeste, crederono"] },
    { key: "ire", title: "-ire", text: "-ii, -isti, -ì, -immo, -iste, -irono.", stock: ["dormii, dormisti, dormì, dormimmo, dormiste, dormirono"] },
    { key: "irr", title: "Irregular: 1, 3, 6", text: "A strong stem for io, lui/lei and loro (-i, -e, -ero); the regular stem for the rest: presi, prendesti, prese, prendemmo, prendeste, presero. And essere: fui, fosti, fu, fummo, foste, furono.", stock: ["fare: feci, facesti, fece…", "venire: venni, venisti, venne…"] },
    REFL_RULE,
  ],
  conj: (vb) => remoteOf(vb.base),
});

const COMPOSTI = [
  { key: "trap", tense: "imperfetto", label: "trapassato prossimo", frame: "" },
  { key: "fut", tense: "futuro", label: "futuro anteriore", frame: "" },
  { key: "cond", tense: "condizionale", label: "condizionale passato", frame: "" },
  { key: "cong", tense: "congiuntivo", label: "", frame: "Penso che" },
  { key: "congtrap", tense: "congImperfetto", label: "", frame: "Pensavo che" },
] as const;

const composti: Def = {
  key: "composti", group: GROUPS[3], it: "I tempi composti", title: "avevo fatto, avrò fatto, avrei fatto, abbia fatto, avessi fatto", kind: "type", ask: "Which form?",
  intro: "Every compound tense is the passato prossimo with the auxiliary in another tense: same choice of avere or essere, same participle, same agreement. Learn the auxiliary in each tense and you have them all.",
  cols: ["Verb", "trapassato", "futuro ant.", "cond. passato", "cong. passato", "cong. trapassato"],
  rules: [
    { key: "trap", title: "Trapassato prossimo", text: "Imperfect of the auxiliary: avevo mangiato, ero andata. What had happened before another past event.", stock: ["avevo già mangiato", "era già partita"] },
    { key: "fut", title: "Futuro anteriore", text: "Future of the auxiliary: avrò mangiato. What will have happened (quando avrò finito…), or a guess about the past (sarà uscito).", stock: ["avrò finito", "sarà arrivata"] },
    { key: "cond", title: "Condizionale passato", text: "Conditional of the auxiliary: avrei mangiato, sarei andata. Would have; also the future seen from the past (ha detto che sarebbe venuto).", stock: ["avrei voluto", "sarebbe venuta"] },
    { key: "cong", title: "Congiuntivo passato", text: "Present subjunctive of the auxiliary: penso che abbia mangiato, che sia andata.", stock: ["penso che abbia capito", "spero che sia arrivata"] },
    { key: "congtrap", title: "Congiuntivo trapassato", text: "Imperfect subjunctive of the auxiliary: pensavo che avesse mangiato; se fossi andata…", stock: ["pensavo che fosse partito", "se avessi saputo"] },
    { key: "essere", title: "Essere agrees", text: "As in the passato prossimo: with essere the participle agrees with the subject.", stock: ["erano andate", "sarei venuta"] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const p = perfectOf(vb.base, vb.refl);
      if (!p) continue;
      const ag = p.aux === "essere" ? ["essere"] : [];
      for (const t of COMPOSTI) {
        WHO.forEach((who, w) => {
          if (t.frame && !w) return; // penso che io…: same subject takes di + infinitive instead
          const a = compound(vb, p, t.tense, w);
          const q = t.frame ? `${t.frame} (${who}) ___ (${whole(vb)})` : `(${who}) ${whole(vb)} · ${t.label}`;
          exercises.push({ id: vb.id, q, en: vb.en, a, rules: [t.key, ...ag], full: t.frame ? `${t.frame} ${a[0]}.` : undefined });
        });
      }
      const lei = COMPOSTI.map((t) => compound(vb, p, t.tense, 3)[0]);
      rows.push({ cells: [whole(vb), ...lei.map((x) => `lei ${x}`)], ex: Object.fromEntries([...COMPOSTI.map((t, i) => [t.key, `lei ${lei[i]}`]), ...(ag.length ? [["essere", `lei ${lei[0]}`]] : [])]) });
    }
    return { rows, exercises };
  },
};

// ── Future, moods and forms ──────────────────────────────────────────────

const FUT_RULES = (endings: string, ex: string): Rule[] => [
  { key: "reg", title: "Regular", text: `-are verbs change -a- to -e-: parlare → parler-. -ere and -ire keep their vowel: prender-, dormir-. Then ${endings}.`, stock: [ex] },
  { key: "care", title: "-care, -gare", text: "Add h to keep the hard sound: cercher-, pagher-.", stock: ["cercherò", "pagherei"] },
  { key: "ciare", title: "-ciare, -giare", text: "The i goes: mangiare → manger-, cominciare → comincer-.", stock: ["mangerò", "comincerei"] },
  { key: "irr", title: "Irregular stems", text: "essere → sar-, avere → avr-, andare → andr-, dovere → dovr-, potere → potr-, sapere → sapr-, vedere → vedr-, vivere → vivr-, venire → verr-, volere → vorr-, tenere → terr-, rimanere → rimarr-, bere → berr-, fare → far-, dare → dar-, stare → star-.", stock: ["sarò", "verrei", "potrà"] },
  REFL_RULE,
];

const futuro = tenseLesson({
  key: "futuro", group: GROUPS[4], it: "Il futuro", title: "The future: parlerò, prenderò, dormirò", kind: "type", ask: "Futuro?",
  intro: "The future is one stem for the whole verb plus one set of endings for every verb: -ò, -ai, -à, -emo, -ete, -anno. Italians also use it to guess: sarà a casa (he's probably at home).",
  rules: FUT_RULES("-ò, -ai, -à, -emo, -ete, -anno", "parlerò, prenderai, dormirà"),
  conj: (vb) => futureOf(vb.base),
});

const condizionale = tenseLesson({
  key: "condizionale", group: GROUPS[4], it: "Il condizionale", title: "The conditional: parlerei, prenderei, dormirei", kind: "type", ask: "Condizionale?",
  intro: "The conditional (would) has exactly the same stem as the future, irregular ones included, with its own endings: -ei, -esti, -ebbe, -emmo, -este, -ebbero. It's also the polite way to ask: vorrei un caffè, potresti aiutarmi?",
  rules: FUT_RULES("-ei, -esti, -ebbe, -emmo, -este, -ebbero", "parlerei, prenderesti, dormirebbe"),
  conj: (vb) => conditionalOf(vb.base),
});

const imperativo: Def = {
  key: "imperativo", group: GROUPS[4], it: "L'imperativo", title: "Commands: parla!, non parlare!, parli!", kind: "type", ask: "Imperativo?",
  intro: "For tu, -are verbs end in -a (parla!) and the others in -i (prendi!, dormi!). Noi and voi are the present (parliamo!, parlate!). The polite Lei uses the subjunctive (parli!). To say don't to tu, use non + the infinitive.",
  cols: ["Verb", "tu", "noi", "voi", "Lei", "non (tu)"],
  rules: [
    { key: "are", title: "tu: -are → -a", text: "parla!, mangia!, cerca!", stock: ["parla!", "guarda!"] },
    { key: "ere", title: "tu: -ere, -ire → -i", text: "prendi!, dormi!, finisci!", stock: ["prendi!", "senti!"] },
    { key: "noivoi", title: "noi, voi", text: "Same as the present: andiamo!, venite!", stock: ["andiamo!", "guardate!"] },
    { key: "lei", title: "Lei (polite)", text: "The present subjunctive: parli!, prenda!, venga!", stock: ["Scusi!", "Venga pure!"] },
    { key: "neg", title: "Negative tu", text: "non + infinitive: non parlare!, non toccare! Noi and voi just add non.", stock: ["non parlare!", "non preoccuparti!"] },
    { key: "irr", title: "Irregular tu", text: "va' (vai), da' (dai), fa' (fai), sta' (stai), di'; essere → sii, siate; avere → abbi, abbiate; sapere → sappi, sappiate.", stock: ["fa' attenzione!", "sii paziente!", "abbi pazienza!"] },
    { key: "refl", title: "Pronouns join the end", text: "alzati!, alziamoci!, alzatevi!, but before Lei: si alzi! Negative: non alzarti! or non ti alzare!", stock: ["alzati!", "sbrigatevi!", "si accomodi!"] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const im = imperativeOf(vb);
      if (!im) continue;
      const base = im.rules.filter((r) => r !== "refl");
      const refl = vb.refl ? ["refl"] : [];
      const items: [string, string, string[]][] = [
        ["tu", im.tu, [...(base.length ? base : ["are"]), ...refl]],
        ["noi", im.noi, ["noivoi", ...refl]],
        ["voi", im.voi, ["noivoi", ...refl]],
        ["Lei", im.lei, ["lei", ...refl]],
        ["tu, non", im.neg, ["neg", ...refl]],
      ];
      for (const [who, f, rules] of items) exercises.push({ id: vb.id, q: `(${who}) ${whole(vb)}!`, en: vb.en, a: alts(f), rules, full: `${cap(first(f))}!` });
      rows.push({ cells: [whole(vb), ...items.map(([, f]) => show(f))], ex: { ...exOf(items[0][2], `${first(im.tu)}!`), noivoi: `${first(im.noi)}!`, lei: `${first(im.lei)}!`, neg: `${first(im.neg)}!` } });
    }
    return { rows, exercises };
  },
};

const STARE = presentOf("stare")!.forms, STAVO = imperfectOf("stare").forms;

const gerundio: Def = {
  key: "gerundio", group: GROUPS[4], it: "Il gerundio", title: "stare + gerund: sto parlando", kind: "type", ask: "What's going on?",
  intro: "The gerund is -ando for -are verbs and -endo for the others. With stare it says what is going on right now (sto mangiando) or was going on (stavo mangiando). Pronouns go before stare or join the gerund: mi sto alzando, sto alzandomi.",
  cols: ["Verb", "gerundio", "adesso (io)", "ieri alle otto (io)"],
  rules: [
    { key: "are", title: "-are → -ando", text: "parlando, mangiando, cercando.", stock: ["parlando", "guardando"] },
    { key: "ere", title: "-ere, -ire → -endo", text: "prendendo, dormendo, finendo (no -isc-).", stock: ["leggendo", "dormendo"] },
    { key: "irr", title: "Irregular", text: "From the old stem: fare → facendo, dire → dicendo, bere → bevendo, porre → ponendo, tradurre → traducendo.", stock: ["facendo", "dicendo"] },
    { key: "stare", title: "stare + gerund", text: "Present of stare for now, imperfect for then: sto leggendo, stavo leggendo quando…", stock: ["sto lavorando", "stavamo dormendo"] },
    { key: "refl", title: "Reflexive", text: "The pronoun before stare, or after the gerund: mi sto vestendo, sto vestendomi.", stock: ["ci stiamo preparando", "sto preparandomi"] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      if (vb.base === "essere" || vb.base === "stare") continue; // sto essendo isn't Italian
      const g = gerundOf(vb.base);
      const irr = !g.startsWith(vb.base.slice(0, -3));
      const rules = [irr ? "irr" : vb.base.endsWith("are") ? "are" : "ere", "stare", ...(vb.refl ? ["refl"] : [])];
      const say = (aux: string[], i: number) => {
        const t = tailOf(vb);
        return vb.refl ? [`${REFL[i]} ${aux[i]} ${g}${t}`, `${aux[i]} ${g}${REFL[i]}${t}`] : [`${aux[i]} ${g}${t}`];
      };
      PERSONS.forEach((who, i) => {
        exercises.push({ id: vb.id, q: `(${who}, adesso) ${whole(vb)}`, en: vb.en, a: say(STARE, i), rules });
        exercises.push({ id: vb.id, q: `(${who}, ieri alle otto) ${whole(vb)}`, en: vb.en, a: say(STAVO, i), rules });
      });
      rows.push({ cells: [whole(vb), g, say(STARE, 0)[0], say(STAVO, 0)[0]], ex: exOf(rules, say(STARE, 0)[0]) });
    }
    return { rows, exercises };
  },
};

const SUBJ_FRAMES = ["Penso che", "Credo che", "Spero che", "Voglio che", "È importante che", "Bisogna che", "Sembra che", "Ho paura che", "Dubito che", "Benché", "Prima che", "Affinché"];
const IND_FRAMES = ["So che", "Sono sicuro che", "È vero che", "Vedo che", "Ti dico che", "Visto che"];
const PAST_SUBJ_FRAMES = ["Pensavo che", "Credevo che", "Speravo che", "Volevo che", "Era importante che", "Vorrei che", "Sembrava che", "Avevo paura che"];
const PAST_IND_FRAMES = ["Sapevo che", "Ero sicuro che", "Era vero che", "Vedevo che"];

function moodLesson(def: Omit<Def, "build" | "cols"> & { subj: (v: string) => { forms: string[] } | null; ind: (v: string) => { forms: string[] } | null; frames: string[]; indFrames: string[] }): Def {
  return {
    ...def,
    cols: ["Verb", ...PERSONS.map((p) => `che ${p}`)],
    build: ({ verbs }) => {
      const rows: Row[] = [], exercises: Exercise[] = [];
      for (const vb of verbs) {
        const s = def.subj(vb.base), ind = def.ind(vb.base);
        if (!s || !ind) continue;
        const sf = phrase(vb, s.forms), inf = phrase(vb, ind.forms);
        const forms = vb.refl ? ["refl"] : [];
        // tu → loro: io would clash with the frames' own io (penso che io…).
        for (let w = 1; w < WHO.length; w++) {
          const i = WHO_PERSON[w];
          const fr = pick(def.frames, vb.id, w), ifr = pick(def.indFrames, vb.id, w);
          const a = alts(sf[i]), b = alts(inf[i]);
          exercises.push({ id: vb.id, q: `${fr} (${WHO[w]}) ___ (${whole(vb)})`, en: vb.en, a, rules: ["sub", ...forms], full: `${fr} ${a[0]}.` });
          if (w % 2) exercises.push({ id: vb.id, q: `${ifr} (${WHO[w]}) ___ (${whole(vb)})`, en: vb.en, a: b, rules: ["ind", ...forms], full: `${ifr} ${b[0]}.` });
        }
        rows.push({ cells: [whole(vb), ...sf.map(show)], ex: { sub: `${def.frames[0]} ${first(sf[2])}`, ind: `${def.indFrames[0]} ${first(inf[2])}`, ...(vb.refl ? { refl: first(sf[0]) } : {}) } });
      }
      return { rows, exercises };
    },
  };
}

const congiuntivo = moodLesson({
  key: "congiuntivo", group: GROUPS[4], it: "Il congiuntivo presente", title: "When and how: penso che sia, so che è", kind: "type", ask: "Congiuntivo or indicativo?",
  intro: "The subjunctive follows che after verbs of opinion, wish, doubt, fear and need (penso che, voglio che, ho paura che, bisogna che), and after benché, prima che, affinché. After certainty and facts (so che, è vero che, sono sicuro che) the indicative stays.",
  rules: [
    { key: "sub", title: "Congiuntivo", text: "After opinion, wish, hope, doubt, fear, need, and impersonal è importante che, sembra che; after benché, prima che, affinché, senza che. -are: -i, -i, -i, -iamo, -iate, -ino; -ere, -ire: -a, -a, -a, -iamo, -iate, -ano.", stock: ["Penso che parli bene.", "Voglio che tu venga."] },
    { key: "ind", title: "Indicativo", text: "After certainty and facts: so che, sono sicuro che, è vero che, vedo che, dico che; and after visto che, perché (because).", stock: ["So che parla bene.", "È vero che viene."] },
    { key: "irr", title: "Irregular", text: "Mostly from the io form of the present: vengo → venga, faccio → faccia, esco → esca. And essere: sia; avere: abbia; sapere: sappia; dare: dia; stare: stia.", stock: ["sia", "abbia", "vada", "faccia"] },
    REFL_RULE,
  ],
  subj: (v) => subjunctiveOf(v), ind: (v) => presentOf(v), frames: SUBJ_FRAMES, indFrames: IND_FRAMES,
});

const congimperfetto = moodLesson({
  key: "congimperfetto", group: GROUPS[4], it: "Il congiuntivo imperfetto", title: "pensavo che fosse, vorrei che venissi", kind: "type", ask: "Congiuntivo or indicativo?",
  intro: "When the main verb is in a past tense or the conditional (pensavo che, vorrei che), the subjunctive moves to the imperfect. It's made on the imperfect's stem: parla-ssi, prende-ssi, dormi-ssi. It's also the verb after se in a 'what if' sentence.",
  rules: [
    { key: "sub", title: "Congiuntivo imperfetto", text: "After pensavo che, volevo che, era importante che, vorrei che: -ssi, -ssi, -sse, -ssimo, -ste, -ssero.", stock: ["Pensavo che fosse a casa.", "Vorrei che tu venissi."] },
    { key: "ind", title: "Indicativo imperfetto", text: "After certainty in the past: sapevo che era a casa.", stock: ["Sapevo che era tardi."] },
    { key: "irr", title: "Irregular", text: "essere → fossi, dare → dessi, stare → stessi, and the old stems fare → facessi, dire → dicessi, bere → bevessi.", stock: ["fossi", "facessi", "stessi"] },
    REFL_RULE,
  ],
  subj: (v) => subjImperfectOf(v), ind: (v) => imperfectOf(v), frames: PAST_SUBJ_FRAMES, indFrames: PAST_IND_FRAMES,
});

const AVERE_TEMPO = { presente: presentOf("avere")!.forms, cong: subjImperfectOf("avere").forms };

const ipotetico: Def = {
  key: "ipotetico", group: GROUPS[4], it: "Il periodo ipotetico", title: "se ho… / se avessi… / se avessi avuto…", kind: "type", ask: "Complete the if-sentence.",
  intro: "Three kinds of if-sentence. Real: se + present, then present or future. Possible or imaginary: se + imperfect subjunctive, then conditional. Impossible, about the past: se + pluperfect subjunctive, then past conditional. The conditional never goes after se.",
  cols: ["Verb", "real", "possible", "past"],
  rules: [
    { key: "t1", title: "Real", text: "Se + presente, then presente or futuro: se piove, resto a casa; se hai tempo, verrai?", stock: ["Se ho tempo, vengo.", "Se piove, resterò a casa."] },
    { key: "t2", title: "Possible", text: "Se + congiuntivo imperfetto, then condizionale: se avessi tempo, verrei.", stock: ["Se avessi soldi, viaggerei.", "Se fossi in te, andrei."] },
    { key: "t3", title: "Impossible (past)", text: "Se + congiuntivo trapassato, then condizionale passato: se avessi saputo, sarei venuto.", stock: ["Se avessi studiato, avrei passato l'esame."] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const pres = presentOf(vb.base);
      if (!pres) continue;
      const pr = phrase(vb, pres.forms), fu = phrase(vb, futureOf(vb.base).forms);
      const ci = phrase(vb, subjImperfectOf(vb.base).forms), co = phrase(vb, conditionalOf(vb.base).forms);
      const p = perfectOf(vb.base, vb.refl);
      const w = whole(vb);
      for (let k = 0; k < 6; k++) {
        const who = PERSONS[k];
        exercises.push({ id: vb.id, q: `Se (${who}) ___ (${w}), sarà meglio.`, en: vb.en, a: alts(pr[k]), rules: ["t1"], full: `Se ${first(pr[k])}, sarà meglio.` });
        exercises.push({ id: vb.id, q: `Se (${who}) ${AVERE_TEMPO.presente[k]} tempo, ___ (${w}).`, en: vb.en, a: [...alts(fu[k]), ...alts(pr[k])], rules: ["t1"], full: `Se ${AVERE_TEMPO.presente[k]} tempo, ${first(fu[k])}.` });
        exercises.push({ id: vb.id, q: `Se (${who}) ___ (${w}), sarebbe meglio.`, en: vb.en, a: alts(ci[k]), rules: ["t2"], full: `Se ${first(ci[k])}, sarebbe meglio.` });
        exercises.push({ id: vb.id, q: `Se (${who}) ${AVERE_TEMPO.cong[k]} tempo, ___ (${w}).`, en: vb.en, a: alts(co[k]), rules: ["t2"], full: `Se ${AVERE_TEMPO.cong[k]} tempo, ${first(co[k])}.` });
      }
      if (p) {
        WHO.forEach((who, wi) => {
          const a = compound(vb, p, "congImperfetto", wi), b = compound(vb, p, "condizionale", wi);
          exercises.push({ id: vb.id, q: `Se (${who}) ___ (${w}), sarebbe stato meglio.`, en: vb.en, a, rules: ["t3"], full: `Se ${a[0]}, sarebbe stato meglio.` });
          exercises.push({ id: vb.id, q: `Se (${who}) ${AVERE_TEMPO.cong[WHO_PERSON[wi]]} avuto tempo, ___ (${w}).`, en: vb.en, a: b, rules: ["t3"], full: `Se ${AVERE_TEMPO.cong[WHO_PERSON[wi]]} avuto tempo, ${b[0]}.` });
        });
      }
      const t3 = p ? `se ${compound(vb, p, "congImperfetto", 0)[0]}, ${compound(vb, p, "condizionale", 0)[0]}` : "";
      rows.push({ cells: [w, `se ${first(pr[0])}, ${first(fu[0])}`, `se ${first(ci[0])}, ${first(co[0])}`, t3], ex: { t1: `se ${first(pr[0])}…`, t2: `se ${first(ci[0])}, ${first(co[0])}`, ...(t3 ? { t3 } : {}) } });
    }
    return { rows, exercises };
  },
};

// ── The sentence ─────────────────────────────────────────────────────────

// [governing verb in the io form, its preposition before an infinitive, its own infinitive]
const GOVERNING: [string, string, string][] = [
  ["comincio", "a", "cominciare"], ["inizio", "a", "iniziare"], ["continuo", "a", "continuare"], ["imparo", "a", "imparare"], ["riesco", "a", "riuscire"],
  ["provo", "a", "provare"], ["vado", "a", "andare"], ["vengo", "a", "venire"], ["mi abituo", "a", "abituarsi"], ["mi preparo", "a", "prepararsi"],
  ["torno", "a", "tornare"], ["mi metto", "a", "mettersi"], ["ti aiuto", "a", "aiutare"], ["ti insegno", "a", "insegnare"],
  ["finisco", "di", "finire"], ["smetto", "di", "smettere"], ["decido", "di", "decidere"], ["cerco", "di", "cercare"], ["spero", "di", "sperare"],
  ["credo", "di", "credere"], ["dimentico", "di", "dimenticare"], ["mi ricordo", "di", "ricordarsi"], ["ho paura", "di", "avere paura"],
  ["ho voglia", "di", "avere voglia"], ["sogno", "di", "sognare"], ["accetto", "di", "accettare"], ["rifiuto", "di", "rifiutare"],
  ["fingo", "di", "fingere"], ["prometto", "di", "promettere"], ["ti chiedo", "di", "chiedere"], ["ti dico", "di", "dire"],
  ["ho molto", "da", ""], ["non c'è niente", "da", ""],
  ["voglio", "", "volere"], ["posso", "", "potere"], ["devo", "", "dovere"], ["so", "", "sapere"], ["preferisco", "", "preferire"],
  ["desidero", "", "desiderare"], ["mi piace", "", "piacere"], ["odio", "", "odiare"], ["oso", "", "osare"],
];
const NONE = "—";
const TAKES_OBJECT = new Set(`fare vedere dire mangiare bere leggere scrivere comprare prendere scegliere studiare imparare capire cercare guardare portare
preparare cucinare lavare pulire sistemare finire raccontare visitare ascoltare chiedere offrire spiegare decidere perdere vincere trovare aspettare
ricordare vendere aprire chiudere mettere provare organizzare pagare spendere tradurre correggere controllare riparare`.split(/\s+/));
/** a → ad before a vowel, as usually written before a: comincio ad andare. */
const ad = (prep: string, next: string) => (prep === "a" && /^[aeiou]/.test(next) ? "ad" : prep);

const verbiprep: Def = {
  key: "verbiprep", group: GROUPS[5], it: "Verbi + preposizione", title: "comincio a, smetto di, voglio —", kind: "choice", ask: "Which preposition before the infinitive?",
  intro: "When one verb follows another, the first decides what comes in between: a (comincio a capire), di (smetto di fumare), or nothing at all (voglio capire). There's no rule that predicts it, so each verb is learned with its preposition.",
  cols: ["Verb", "Takes", "As the second verb"],
  rules: [
    { key: "a", title: "a", text: "Starting, continuing, learning, managing, going and coming: comincio a, continuo a, imparo a, riesco a, vado a, mi metto a, ti aiuto a. Before a vowel it's usually written ad: comincio ad aprire.", stock: ["comincio a capire", "riesco a dormire"] },
    { key: "di", title: "di", text: "Finishing, deciding, trying, hoping, remembering, asking and saying: finisco di, smetto di, decido di, cerco di, spero di, mi ricordo di, ho paura di, ti chiedo di.", stock: ["smetto di fumare", "cerco di capire"] },
    { key: "da", title: "da", text: "Something to do: ho molto da fare, non c'è niente da vedere.", stock: ["ho molto da fare", "qualcosa da bere"] },
    { key: "none", title: "Nothing", text: "volere, potere, dovere, sapere, preferire, desiderare, and piacere: voglio venire, mi piace leggere.", stock: ["voglio venire", "devo partire"] },
  ],
  build: ({ verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const inf = (vb.refl ? vb.inf.slice(0, -2) + "mi" : vb.inf) + tailOf(vb);
      const own = GOVERNING.find(([, , g]) => g === vb.base || g === vb.inf || g === whole(vb));
      // "Ho molto da dormire" isn't Italian: da wants a verb that takes an object.
      const intransitive = vb.refl || vb.rest !== "" || !TAKES_OBJECT.has(vb.base);
      GOVERNING.forEach(([gov, prep, g], k) => {
        if (g === vb.base || (k + vb.id) % 4 || (prep === "da" && intransitive)) return; // a sample of the governing verbs per word
        const a = prep || NONE;
        const full = `${cap(gov)} ${prep ? `${ad(prep, inf)} ` : ""}${inf}.`;
        exercises.push({ id: vb.id, q: `${cap(gov)} ___ ${inf}.`, en: vb.en, a: [a], opts: ["a", "di", "da", NONE], rules: [prep || "none"], full });
      });
      const sample = pick(GOVERNING.filter(([, , g]) => g !== vb.base), vb.id);
      const second = `${cap(sample[0])} ${sample[1] ? `${ad(sample[1], inf)} ` : ""}${inf}`;
      const takes = own ? `${whole(vb)} ${own[1] || ""} + infinitive`.replace("  ", " ") : "";
      rows.push({ cells: [whole(vb), takes, second], ex: own ? { [own[1] || "none"]: takes } : {} });
    }
    return { rows, exercises };
  },
};

// Verbs that make sense with people and things alike.
const PASSIVE_VERBS = [["cercare", "cercato"], ["vedere", "visto"], ["trovare", "trovato"], ["scegliere", "scelto"], ["aspettare", "aspettato"], ["notare", "notato"]] as const;

const passivo: Def = {
  key: "passivo", group: GROUPS[5], it: "Il passivo e il si", title: "è comprato, viene comprato, si compra", kind: "type", ask: "Complete it.",
  intro: "The passive is essere + participle, and the participle agrees with the subject: la casa è venduta. In simple tenses venire works too (viene venduta). Italians often prefer si: si vende la casa, si vendono le case, where the verb agrees with the thing. With no thing at all, si means 'people, one': si mangia bene qui.",
  cols: ["Word", "passivo", "passato", "si"],
  rules: [
    { key: "pass", title: "essere + participle", text: "The participle agrees with the subject; da says who did it: lo schermo è comprato da Marco.", stock: ["la casa è venduta", "i libri sono letti"] },
    { key: "venire", title: "venire + participle", text: "Instead of essere in the simple tenses: viene comprato, verrà comprato.", stock: ["viene servito", "venivano usate"] },
    { key: "past", title: "In the past", text: "è stato comprato: stato agrees too (è stata comprata, sono stati comprati).", stock: ["è stata venduta", "sono stati trovati"] },
    { key: "si", title: "si passivante", text: "si + verb in the third person, agreeing with the thing: si usa lo schermo, si usano le chiavi.", stock: ["si vende la casa", "si affittano camere"] },
    { key: "imp", title: "si impersonale", text: "With no thing: si dorme, si va. A reflexive verb becomes ci si: ci si alza presto.", stock: ["si mangia bene", "ci si diverte"] },
  ],
  build: ({ nouns, verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const n of nouns) {
      const forms: { art: string; noun: string; tail: string; plural: boolean; g: "m" | "f" }[] = [];
      if (n.gender) forms.push({ ...n, g: n.gender });
      const p = !n.plural && asPlural(n);
      if (p) forms.push({ ...p, plural: true, g: p.gender });
      if (!forms.length) continue;
      const cells: string[] = [np(n.art, n)];
      const ex: Record<string, string> = {};
      forms.forEach((f, fi) => {
        const [inf, pp] = pick(PASSIVE_VERBS, n.id, fi);
        const subj = cap(np(f.art, f));
        const part = agree(pp, f.g, f.plural);
        const pres = presentOf(inf)!.forms, fut = futureOf("venire").forms;
        const e = f.plural ? "sono" : "è", v = f.plural ? presentOf("venire")!.forms[5] : presentOf("venire")!.forms[2];
        const s = f.plural ? "saranno" : "sarà", vv = f.plural ? fut[5] : fut[2];
        exercises.push({ id: n.id, q: `${subj} ___ da Marco. (${inf}, presente)`, en: n.en, a: [`${e} ${part}`, `${v} ${part}`], rules: ["pass", "venire"], full: `${subj} ${e} ${part} da Marco.` });
        exercises.push({ id: n.id, q: `${subj} ___ da Marco. (${inf}, passato prossimo)`, en: n.en, a: [`${e} ${agree("stato", f.g, f.plural)} ${part}`], rules: ["past"], full: `${subj} ${e} ${agree("stato", f.g, f.plural)} ${part} da Marco.` });
        exercises.push({ id: n.id, q: `${subj} ___ da Marco. (${inf}, futuro)`, en: n.en, a: [`${s} ${part}`, `${vv} ${part}`], rules: ["pass", "venire"], full: `${subj} ${s} ${part} da Marco.` });
        const si = `si ${pres[f.plural ? 5 : 2]}`;
        exercises.push({ id: n.id, q: `Qui ___ ${np(f.art, f)}. (${inf}, si)`, en: n.en, a: [si], rules: ["si"], full: `Qui ${si} ${np(f.art, f)}.` });
        if (fi === 0) {
          cells.push(`${np(f.art, f)} ${e} ${part}`, `${np(f.art, f)} ${e} ${agree("stato", f.g, f.plural)} ${part}`, `${si} ${np(f.art, f)}`);
          Object.assign(ex, { pass: `${np(f.art, f)} ${e} ${part}`, past: `${e} ${agree("stato", f.g, f.plural)} ${part}`, si: `${si} ${np(f.art, f)}` });
        }
      });
      rows.push({ cells, ex });
    }
    for (const vb of verbs) {
      const pres = presentOf(vb.base);
      if (!pres || vb.base === "essere") continue;
      const plural = /^(i|gli|le) /.test(vb.rest);
      const f = pres.forms[plural ? 5 : 2];
      const si = `${vb.refl ? "ci si" : "si"} ${alts(f)[0]}${tailOf(vb)}`;
      exercises.push({ id: vb.id, q: `In Italia ___ (${whole(vb)}, si impersonale)`, en: vb.en, a: [si], rules: ["imp"], full: `In Italia ${si}.` });
      rows.push({ cells: [whole(vb), "", "", si], ex: { imp: si } });
    }
    return { rows, exercises };
  },
};

const nessuno = (noun: string, g: "m" | "f") => (g === "f" ? (vowelSound(noun) ? "nessun'" : "nessuna") : loSound(noun) ? "nessuno" : "nessun");
const NEG_WORDS = [["mai", "never"], ["più", "no longer"]] as const;

const negazione: Def = {
  key: "negazione", group: GROUPS[5], it: "La negazione", title: "non … mai, non … più, non … ancora, nessuno", kind: "type", ask: "Say it in the negative.",
  intro: "Non goes before the verb and before any pronouns. Words like mai, più, ancora, niente and nessuno don't replace it: Italian keeps both (non vedo niente). In compound tenses mai, più and ancora sit between the auxiliary and the participle.",
  cols: ["Word", "present", "past"],
  rules: [
    { key: "non", title: "non", text: "Before the verb and its pronouns: non lo so, non mi alzo.", stock: ["non capisco", "non lo vedo"] },
    { key: "mai", title: "non … mai, non … più", text: "Never, no longer: around the verb, and between auxiliary and participle: non vado mai, non ho mai visto, non abito più qui.", stock: ["non bevo mai caffè", "non ci sono più andato"] },
    { key: "ancora", title: "non … ancora", text: "Not yet, mostly with compound tenses: non ho ancora mangiato.", stock: ["non è ancora arrivata", "non ho ancora finito"] },
    { key: "nessuno", title: "nessuno, niente", text: "Double negative: non c'è nessuno, non vedo niente. Before a noun nessuno goes like un/uno/una: nessun problema, nessuno sbaglio, nessuna idea, nessun'altra.", stock: ["nessun problema", "non c'è nessuna differenza"] },
  ],
  build: ({ nouns, verbs }) => {
    const rows: Row[] = [], exercises: Exercise[] = [];
    for (const vb of verbs) {
      const pres = presentOf(vb.base);
      const p = perfectOf(vb.base, vb.refl);
      if (!pres && !p) continue;
      const t = tailOf(vb);
      let a0 = "", b0 = "";
      if (pres) {
        PERSONS.forEach((who, i) => {
          const [w, en] = pick(NEG_WORDS, vb.id, i);
          const a = alts(pres.forms[i]).map((f) => `non ${vb.refl ? `${REFL[i]} ` : ""}${f} ${w}${t}`);
          exercises.push({ id: vb.id, q: `(${who}) ${whole(vb)} · ${en}`, en: vb.en, a, rules: ["non", "mai"] });
          if (!i) a0 = a[0];
        });
      }
      if (p) {
        WHO.forEach((who, wi) => {
          const [w, en] = wi % 3 === 0 ? ["ancora", "not yet"] : pick(NEG_WORDS, vb.id, wi);
          const a = compound(vb, p, "presente", wi, w).map((x) => `non ${x}`);
          exercises.push({ id: vb.id, q: `(${who}) ${whole(vb)} · ${en}, passato prossimo`, en: vb.en, a, rules: ["non", w === "ancora" ? "ancora" : "mai"] });
          if (!wi) b0 = a[0];
        });
      }
      rows.push({ cells: [whole(vb), a0, b0], ex: { ...(a0 ? { mai: a0 } : {}), ...(b0 ? { ancora: b0, non: b0 } : {}) } });
    }
    for (const n of nouns) {
      if (n.plural || !n.gender) continue;
      const a = np(nessuno(n.noun, n.gender), n);
      exercises.push({ id: n.id, q: `Non c'è ___ (${np(n.art, n)})`, en: n.en, a: [a], rules: ["nessuno"], full: `Non c'è ${a}.` });
      rows.push({ cells: [np(n.art, n), `non c'è ${a}`, ""], ex: { nessuno: a } });
    }
    return { rows, exercises };
  },
};

export const LESSONS: Def[] = [
  articoli, un, plurale, dimostrativi, possessivi,
  aggettivi, comparativi,
  preposizioni, pronomi, cine, relativi, piacere,
  presente, passato, imperfetto, ppimperfetto, remoto, composti,
  futuro, condizionale, imperativo, gerundio, congiuntivo, congimperfetto, ipotetico,
  verbiprep, passivo, negazione,
];

export const LESSON_KEYS = LESSONS.map((l) => l.key) as [string, ...string[]];

/** The words of the list sorted into nouns, verbs and adjectives (a word can be none). */
export function sortWords(list: GrammarWord[]): Words {
  return {
    nouns: list.map(parseNoun).filter((n): n is Noun => n !== null),
    verbs: list.map(parseVerb).filter((v): v is Verb => v !== null),
    adjs: list.map(parseAdjective).filter((a): a is Adjective => a !== null),
  };
}

/** Every lesson, worked out on these words. */
export function buildLessons(list: GrammarWord[], only?: string): Lesson[] {
  const w = sortWords(list);
  return LESSONS.filter((d) => !only || d.key === only).map(({ build, ...d }) => ({ ...d, ...build(w) }));
}


/**
 * A lesson for the voice tutor (the get_grammar tool): its rules and a round of
 * exercises on the user's words, one per word first. Without a topic, the list
 * of topics with how many of the user's words each one has.
 */
export function grammarForVoice(list: GrammarWord[], topic?: string, limit = 10) {
  if (!topic) {
    return {
      topics: buildLessons(list).map((l) => ({ topic: l.key, name: l.it, about: l.title, words: l.rows.length })),
      instruction: "Ask which topic the user wants, or suggest one with words; then call get_grammar with it.",
    };
  }
  const [l] = buildLessons(list, topic);
  if (!l) throw new Error(`unknown topic ${topic}`);
  const seen = new Set<number>(), firsts: Exercise[] = [], rest: Exercise[] = [];
  for (const e of shuffle(l.exercises.slice())) (seen.has(e.id) ? rest : firsts).push(e), seen.add(e.id);
  const title = Object.fromEntries(l.rules.map((r) => [r.key, r.title]));
  return {
    topic: l.key,
    name: l.it,
    about: l.title,
    intro: l.intro,
    ask: l.ask,
    rules: l.rules.map((r) => ({ title: r.title, text: r.text, examples: r.stock })),
    exercises: [...firsts, ...rest].slice(0, limit).map((e) => ({
      q: e.q,
      hint: e.en,
      answers: e.a,
      ...(e.opts ? { options: e.opts } : {}),
      ...(e.full ? { full: e.full } : {}),
      rule: e.rules.map((r) => title[r]).filter(Boolean).join(" · "),
    })),
    available: l.exercises.length,
    instruction: l.exercises.length
      ? "One exercise at a time: say q (read ___ as a short pause or 'blank'); after the answer say the right form or full sentence, and if it was wrong, the rule in a few words. Don't grade with record_attempt. After the round, offer more (call again) or another topic."
      : "None of the user's words fit this topic yet: explain the main rule in two sentences with the examples, practise with a few sentences of your own, and suggest saving some words it needs.",
  };
}
