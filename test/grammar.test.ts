import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLessons, type GrammarWord, parseNoun, parseVerb, perfectOf, pluralOf, presentOf, renderGrammar } from "../src/grammar.js";

const word = (italian: string, english = "x", note: string | null = null, id = 1): GrammarWord => ({ id, italian, english, note });
const plural = (italian: string, note: string | null = null) => {
  const n = parseNoun(word(italian, "x", note));
  const p = n && pluralOf(n);
  return p && (p.art.endsWith("'") ? p.art + p.noun : `${p.art} ${p.noun}`);
};

test("nouns: article and gender, and words that aren't article + noun are left out", () => {
  assert.deepEqual(parseNoun(word("Lo Schermo")), { id: 1, en: "x", art: "lo", noun: "schermo", plural: false, gender: "m" });
  assert.equal(parseNoun(word("l’amica"))?.gender, "f");
  assert.equal(parseNoun(word("l'ospedale"))?.gender, null, "l' + -e: gender unknown");
  assert.equal(parseNoun(word("l'ospedale", "x", "masculine"))?.gender, "m", "unless the note says");
  assert.equal(parseNoun(word("le chiavi"))?.plural, true);
  assert.equal(parseNoun(word("stanco")), null);
  assert.equal(parseNoun(word("il ferro da stiro")), null);
  assert.equal(parseNoun(word("il zaino")), null, "an article against the rules is never taught");
});

test("plurals: endings, spelling, invariables and irregulars, article included", () => {
  assert.equal(plural("lo schermo"), "gli schermi");
  assert.equal(plural("la casa"), "le case");
  assert.equal(plural("la chiave"), "le chiavi");
  assert.equal(plural("l'amica"), "le amiche");
  assert.equal(plural("l'amico"), "gli amici");
  assert.equal(plural("il parco"), "i parchi");
  assert.equal(plural("la camicia"), "le camicie");
  assert.equal(plural("la spiaggia"), "le spiagge");
  assert.equal(plural("l'allergia"), "le allergie");
  assert.equal(plural("lo zio"), "gli zii");
  assert.equal(plural("il negozio"), "i negozi");
  assert.equal(plural("la via"), "le vie");
  assert.equal(plural("il re"), "i re");
  assert.equal(plural("la città"), "le città");
  assert.equal(plural("lo sport"), "gli sport");
  assert.equal(plural("la foto"), "le foto");
  assert.equal(plural("il problema"), "i problemi");
  assert.equal(plural("l'uovo"), "le uova");
  assert.equal(plural("l'uomo"), "gli uomini");
  assert.equal(plural("il dio"), "gli dei");
  assert.equal(plural("il fuoco"), "i fuochi");
  assert.equal(plural("il cuscinetto"), "i cuscinetti");
  assert.equal(plural("il tacchino"), "i tacchini");
  assert.equal(plural("il bianco"), null, "an unknown -co is not guessed");
  assert.equal(plural("l'ospedale"), null, "nor is the article of an unknown gender");
});

test("present tense: regular groups, spelling, -isc-, irregulars and compounds", () => {
  const p = (v: string) => presentOf(v)?.forms.join(" ");
  assert.equal(p("parlare"), "parlo parli parla parliamo parlate parlano");
  assert.equal(p("cercare"), "cerco cerchi cerca cerchiamo cercate cercano");
  assert.equal(p("studiare"), "studio studi studia studiamo studiate studiano");
  assert.equal(p("inviare"), "invio invii invia inviamo inviate inviano");
  assert.equal(p("prendere"), "prendo prendi prende prendiamo prendete prendono");
  assert.equal(p("dormire"), "dormo dormi dorme dormiamo dormite dormono");
  assert.equal(p("capire"), "capisco capisci capisce capiamo capite capiscono");
  assert.equal(p("andare"), "vado vai va andiamo andate vanno");
  assert.equal(p("mantenere"), "mantengo mantieni mantiene manteniamo mantenete mantengono");
  assert.equal(p("scegliere"), "scelgo scegli sceglie scegliamo scegliete scelgono");
  assert.equal(p("riuscire"), "riesco riesci riesce riusciamo riuscite riescono");
  assert.equal(p("restare"), "resto resti resta restiamo restate restano", "not a compound of stare");
  assert.equal(p("spedire"), "spedisco spedisci spedisce spediamo spedite spediscono", "not a compound of dire");
  assert.equal(p("rifare"), undefined, "rifà: left out");
  assert.equal(p("apparire"), undefined, "an unknown -ire verb is not guessed");
});

test("passato prossimo: auxiliary and participle, or nothing when unsure", () => {
  assert.deepEqual(perfectOf("mangiare", false), { aux: "avere", pp: "mangiato", rules: ["avere", "pp"] });
  assert.deepEqual(perfectOf("andare", false), { aux: "essere", pp: "andato", rules: ["essere", "pp"] });
  assert.deepEqual(perfectOf("alzare", true), { aux: "essere", pp: "alzato", rules: ["refl", "pp"] });
  assert.equal(perfectOf("prendere", false)?.pp, "preso");
  assert.equal(perfectOf("sorprendere", false)?.pp, "sorpreso");
  assert.equal(perfectOf("decidere", false)?.pp, "deciso");
  assert.equal(perfectOf("scegliere", false)?.pp, "scelto");
  assert.equal(perfectOf("aprire", false)?.pp, "aperto");
  assert.equal(perfectOf("sparire", false)?.pp, "sparito");
  assert.equal(perfectOf("vendere", false)?.pp, "venduto");
  assert.equal(perfectOf("salire", false), null, "essere or avere: left out");
  assert.equal(perfectOf("assolvere", false)?.pp, "assolto");
  assert.equal(perfectOf("fondere", false), null, "an unknown -ere participle is not guessed");
});

test("verbs: infinitives with an English 'to', reflexives and phrases", () => {
  assert.deepEqual(parseVerb(word("alzarsi", "to get up")), { id: 1, en: "to get up", inf: "alzarsi", base: "alzare", rest: "", refl: true });
  assert.equal(parseVerb(word("distrarsi", "to get distracted"))?.base, "distrarre");
  assert.equal(parseVerb(word("mostrarsi", "to show oneself"))?.base, "mostrare");
  assert.equal(parseVerb(word("fare la spesa", "to do the shopping"))?.rest, "la spesa");
  assert.equal(parseVerb(word("il piacere", "pleasure")), null);
  assert.equal(parseVerb(word("piacere", "pleasure")), null, "no 'to': a noun");
  assert.equal(parseVerb(word("piacere", "pleasure", "verb"))?.base, "piacere", "unless the note says verb");
});

test("lessons: built from the words, with exercises that ask for their forms", () => {
  const list = [word("lo schermo", "the screen", null, 1), word("cercare", "to look for", null, 2), word("alzarsi", "to get up", null, 3)];
  const lessons = buildLessons(list);
  assert.deepEqual(lessons.map((l) => l.key), ["articoli", "un", "plurale", "preposizioni", "presente", "passato"]);
  const by = Object.fromEntries(lessons.map((l) => [l.key, l]));
  assert.deepEqual(by.articoli.exercises[0], { id: 1, q: "___ schermo", en: "the screen", a: ["lo"], opts: ["il", "lo", "la", "l'"], rules: ["lo"] });
  assert.deepEqual(by.un.exercises[0].a, ["uno"]);
  assert.deepEqual(by.plurale.exercises[0].a, ["gli schermi"]);
  const nello = by.preposizioni.exercises.find((e) => e.q === "in + lo schermo")!;
  assert.deepEqual(nello.a, ["nello schermo"]);
  assert.equal(nello.opts!.length, 4);
  assert.ok(nello.opts!.includes("nello schermo"));
  assert.ok(by.preposizioni.exercises.some((e) => e.q === "di + gli schermi" && e.a[0] === "degli schermi"), "the plural too");
  assert.ok(by.presente.exercises.some((e) => e.q === "(noi) cercare" && e.a[0] === "cerchiamo"));
  assert.ok(by.presente.exercises.some((e) => e.q === "(io) alzarsi" && e.a[0] === "mi alzo"));
  assert.deepEqual(by.passato.exercises.find((e) => e.q === "(lei) alzarsi")!.a, ["si è alzata"]);
  assert.deepEqual(by.passato.exercises.find((e) => e.q === "(io) alzarsi")!.a, ["mi sono alzato", "mi sono alzata"]);
  // Rules show your words as their examples.
  assert.deepEqual(by.plurale.rows[0].ex, { "o-i": "lo schermo → gli schermi", art: "lo schermo → gli schermi" });
});

test("grammar page: lesson list, a lesson with your words, and data that can't break out", () => {
  const list = [word("lo schermo", "</script><script>alert(1)</script>", null, 1), word("cercare", "to look for", null, 2)];
  const index = renderGrammar("tok/en", list, "");
  assert.match(index, /aria-current="page">Grammar</);
  assert.match(index, /href="\/grammar\/tok%2Fen\?l=plurale"/);
  assert.match(index, /1 of your words/);
  assert.ok(!index.includes("<script>alert(1)"));

  const lesson = renderGrammar("t", list, "plurale");
  assert.match(lesson, /Il plurale/);
  assert.match(lesson, /lo schermo → gli schermi/);
  assert.ok(!lesson.includes("<script>alert(1)"));
  const data = JSON.parse(lesson.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1]);
  assert.equal(data.kind, "type");
  assert.deepEqual(data.exercises[0].a, ["gli schermi"]);

  const empty = renderGrammar("t", [], "presente");
  assert.match(empty, /None of your words fit this lesson yet/);
  assert.ok(!empty.includes('id="p-start"'));
});
