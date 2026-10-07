import assert from "node:assert/strict";
import { test } from "node:test";
import { renderGrammar } from "../src/grammar.js";
import {
  adjectiveForms, conditionalOf, futureOf, gerundOf, type GrammarWord, imperativeOf, imperfectOf, issimo, parseAdjective, parseNoun,
  parseVerb, perfectOf, pluralOf, presentOf, remoteOf, subjImperfectOf, subjunctiveOf,
} from "../src/italian.js";
import { buildLessons, grammarForVoice, LESSONS } from "../src/lessons.js";

const word = (italian: string, english = "x", note: string | null = null, id = 1): GrammarWord => ({ id, italian, english, note });
const plural = (italian: string, note: string | null = null) => {
  const n = parseNoun(word(italian, "x", note));
  const p = n && pluralOf(n);
  return p && (p.art.endsWith("'") ? p.art + p.noun : `${p.art} ${p.noun}`);
};

test("nouns: article and gender, and words that aren't article + noun are left out", () => {
  assert.deepEqual(parseNoun(word("Lo Schermo")), { id: 1, en: "x", art: "lo", noun: "schermo", tail: "", plural: false, gender: "m" });
  assert.equal(parseNoun(word("il telefono cellulare"))?.tail, "cellulare");
  assert.equal(parseNoun(word("l’amica"))?.gender, "f");
  assert.equal(parseNoun(word("l'ospedale"))?.gender, null, "l' + -e: gender unknown");
  assert.equal(parseNoun(word("l'ospedale", "x", "masculine"))?.gender, "m", "unless the note says");
  assert.equal(parseNoun(word("le chiavi"))?.plural, true);
  assert.equal(parseNoun(word("stanco")), null);
  assert.equal(parseNoun(word("il ferro da stiro"))?.tail, "da stiro", "carried along where the noun stays singular");
  assert.equal(plural("il ferro da stiro"), null, "but never made plural");
  assert.equal(parseNoun(word("il mio cane")), null);
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
  assert.equal(lessons.length, 28);
  assert.deepEqual(lessons.map((l) => l.key), LESSONS.map((l) => l.key));
  const by = Object.fromEntries(lessons.map((l) => [l.key, l]));
  assert.deepEqual(by.articoli.exercises[0], { id: 1, q: "___ schermo", en: "the screen", a: ["lo"], opts: ["il", "lo", "la", "l'"], rules: ["lo"], full: "lo schermo" });
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
  assert.match(index, /<h2 class="group" lang="it">La frase<\/h2>/);
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

test("adjectives: recognised by their English, four forms or two, -co spelling", () => {
  assert.deepEqual(parseAdjective(word("stanco", "tired"))?.forms, ["stanco", "stanca", "stanchi", "stanche"]);
  assert.deepEqual(parseAdjective(word("stanca", "tired"))?.m, "stanco", "saved in the feminine");
  assert.deepEqual(parseAdjective(word("felice", "happy"))?.forms, ["felice", "felice", "felici", "felici"]);
  assert.deepEqual(adjectiveForms("simpatico"), ["simpatico", "simpatica", "simpatici", "simpatiche"]);
  assert.deepEqual(adjectiveForms("lungo"), ["lungo", "lunga", "lunghi", "lunghe"]);
  assert.deepEqual(adjectiveForms("ottimista"), ["ottimista", "ottimista", "ottimisti", "ottimiste"]);
  assert.deepEqual(adjectiveForms("rosa"), ["rosa", "rosa", "rosa", "rosa"]);
  assert.deepEqual(issimo(parseAdjective(word("stanco", "tired"))!), ["stanchissimo", "stanchissima", "stanchissimi", "stanchissime"]);
  assert.equal(parseAdjective(word("spesso", "often")), null, "an adverb");
  assert.equal(parseAdjective(word("pane", "bread")), null, "a noun without its article");
  assert.equal(parseAdjective(word("cercare", "to look for")), null);
});

test("verbs in every tense: regular, spelling, irregular", () => {
  const f = (c: { forms: string[] } | null) => c?.forms.join(" ");
  assert.equal(f(imperfectOf("parlare")), "parlavo parlavi parlava parlavamo parlavate parlavano");
  assert.equal(f(imperfectOf("fare")), "facevo facevi faceva facevamo facevate facevano");
  assert.equal(f(imperfectOf("essere")), "ero eri era eravamo eravate erano");
  assert.equal(f(futureOf("cercare")), "cercherò cercherai cercherà cercheremo cercherete cercheranno");
  assert.equal(f(futureOf("mangiare")), "mangerò mangerai mangerà mangeremo mangerete mangeranno");
  assert.equal(f(futureOf("mantenere")), "manterrò manterrai manterrà manterremo manterrete manterranno");
  assert.equal(f(conditionalOf("andare")), "andrei andresti andrebbe andremmo andreste andrebbero");
  assert.equal(f(subjunctiveOf("cercare")), "cerchi cerchi cerchi cerchiamo cerchiate cerchino");
  assert.equal(f(subjunctiveOf("mangiare")), "mangi mangi mangi mangiamo mangiate mangino");
  assert.equal(f(subjunctiveOf("capire")), "capisca capisca capisca capiamo capiate capiscano");
  assert.equal(f(subjunctiveOf("venire")), "venga venga venga veniamo veniate vengano");
  assert.equal(f(subjunctiveOf("essere")), "sia sia sia siamo siate siano");
  assert.equal(f(subjImperfectOf("fare")), "facessi facessi facesse facessimo faceste facessero");
  assert.equal(f(subjImperfectOf("stare")), "stessi stessi stesse stessimo steste stessero");
  assert.equal(f(remoteOf("parlare")), "parlai parlasti parlò parlammo parlaste parlarono");
  assert.equal(f(remoteOf("prendere")), "presi prendesti prese prendemmo prendeste presero");
  assert.equal(f(remoteOf("scegliere")), "scelsi scegliesti scelse scegliemmo sceglieste scelsero");
  assert.equal(f(remoteOf("venire")), "venni venisti venne venimmo veniste vennero");
  assert.equal(f(remoteOf("credere")), "credei|credetti credesti credé|credette credemmo credeste crederono|credettero");
  assert.equal(remoteOf("fondere"), null, "an unknown -ere remote isn't guessed");
  assert.equal(gerundOf("parlare"), "parlando");
  assert.equal(gerundOf("dormire"), "dormendo");
  assert.equal(gerundOf("dire"), "dicendo");
  const imp = (w: string, en = "to x") => imperativeOf(parseVerb(word(w, en))!);
  assert.deepEqual(imp("cercare"), { tu: "cerca", noi: "cerchiamo", voi: "cercate", lei: "cerchi", neg: "non cercare", rules: ["are"] });
  assert.deepEqual(imp("alzarsi"), { tu: "alzati", noi: "alziamoci", voi: "alzatevi", lei: "si alzi", neg: "non alzarti|non ti alzare", rules: ["refl"] });
  assert.equal(imp("andare")?.tu, "va'|vai");
  assert.equal(imp("avere pazienza", "to be patient")?.tu, "abbi pazienza");
  assert.equal(imp("dovere"), null);
});

test("sentence lessons: the words in their frames", () => {
  const list = [word("lo schermo", "the screen", null, 1), word("cercare", "to look for", null, 2), word("andare", "to go", null, 3), word("stanco", "tired", null, 4)];
  const by = Object.fromEntries(buildLessons(list).map((l) => [l.key, l]));
  const find = (key: string, q: string) => by[key].exercises.find((e) => e.q === q)!;
  assert.deepEqual(find("aggettivi", "Giulia e Anna sono ___ (stanco)").a, ["stanche"]);
  assert.deepEqual(find("possessivi", "(io) lo schermo").a, ["il mio schermo"]);
  assert.ok(by.dimostrativi.exercises.some((e) => e.a[0] === "quegli schermi"));
  assert.ok(by.pronomi.exercises.some((e) => /^Ho \w+ lo schermo\.$/.test(e.q) && /^l'ho \w+o$/.test(e.a[0])));
  assert.ok(by.pronomi.exercises.some((e) => /^Ho \w+ gli schermi\.$/.test(e.q) && /^li ho \w+i$/.test(e.a[0])), "agreement in the plural");
  assert.deepEqual(find("cine", "Penso allo schermo.").a, ["ci penso"]);
  assert.deepEqual(find("cine", "Ho tre schermi.").a, ["ne ho tre"]);
  assert.deepEqual(find("relativi", "Lo schermo ___ ti ho parlato è qui.").a, ["di cui", "del quale"], "after a preposition both are right");
  assert.deepEqual(find("piacere", "(a me) lo schermo").a, ["mi piace lo schermo"]);
  assert.ok(by.congiuntivo.exercises.some((e) => /^(Penso|Credo|Spero|Voglio|È importante|Bisogna|Sembra|Ho paura|Dubito|Benché|Prima|Affinché)/.test(e.q) && e.q.includes("(lui) ___ (cercare)") && e.a[0] === "cerchi"));
  assert.ok(by.congiuntivo.exercises.some((e) => /^(So|Sono sicuro|È vero|Vedo|Ti dico|Visto) /.test(e.q) && e.q.includes("___ (cercare)") && ["cerchi", "cerca", "cerchiamo", "cercate", "cercano"].includes(e.a[0])));
  assert.deepEqual(find("ipotetico", "Se (io) ___ (andare), sarebbe stato meglio.").a, ["fossi andato", "fossi andata"]);
  assert.deepEqual(find("ipotetico", "Se (noi) ___ (cercare), sarebbe meglio.").a, ["cercassimo"]);
  assert.deepEqual(find("negazione", "Non c'è ___ (lo schermo)").a, ["nessuno schermo"]);
  assert.ok(by.verbiprep.exercises.every((e) => e.opts!.includes(e.a[0])));
  assert.ok(by.passivo.exercises.some((e) => /^Lo schermo ___ da Marco\. \(\w+, passato prossimo\)$/.test(e.q) && /^è stato \w+o$/.test(e.a[0])));
  assert.ok(by.passivo.exercises.some((e) => e.q === "In Italia ___ (cercare, si impersonale)" && e.a[0] === "si cerca"));
  assert.ok(by.composti.exercises.some((e) => e.q === "(lei) andare · trapassato prossimo" && e.a[0] === "era andata"));
  assert.ok(!by.composti.exercises.some((e) => e.q.startsWith("Penso che (io)")), "penso che io: not a subjunctive case");
});

test("grammar by voice: topics, then a round of exercises on the words", () => {
  const list = [word("lo schermo", "the screen", null, 1), word("la chiave", "the key", null, 2), word("cercare", "to look for", null, 3)];
  const all = grammarForVoice(list) as { topics: { topic: string; words: number }[] };
  assert.equal(all.topics.length, 28);
  assert.equal(all.topics.find((t) => t.topic === "plurale")!.words, 2);
  const r = grammarForVoice(list, "plurale", 5) as { exercises: { q: string; answers: string[]; rule: string }[]; rules: unknown[]; available: number };
  assert.equal(r.exercises.length, 2);
  assert.deepEqual(new Set(r.exercises.map((e) => e.q)), new Set(["lo schermo", "la chiave"]), "one per word first");
  assert.ok(r.exercises.every((e) => e.answers.length && e.rule));
  const none = grammarForVoice([], "congiuntivo") as { exercises: unknown[]; instruction: string };
  assert.equal(none.exercises.length, 0);
  assert.match(none.instruction, /None of the user's words/);
  assert.throws(() => grammarForVoice(list, "nope"));
});
