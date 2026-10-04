import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { normalizeContentLanguageCode, normalizeNoteLanguage, normalizeSpokenLanguageCode, resolveMaterialLanguage, detectSourceLanguage, buildGeneratedContentLanguageInstruction } from '../src/lib/languages.ts';
import { judgeHeard } from '../src/lib/tutor/turn-audio.ts';
import { SONIOX_LANGUAGES, resolveSpeechLanguage, needsEnglishSpeechFallback, toSpeechScript } from '../src/lib/speech-language.ts';
import { sourceLanguageSchema, sampleSourceLanguage, SOURCE_LANGUAGE_INSTRUCTIONS, isContradictedBySpelling, carriesNoLanguage } from '../src/lib/source-language-policy.ts';
import { generationCacheKey } from '../src/lib/notes/generation-cache-key.ts';
import { buildSourceNoteInstructions, normalizeNoteCalloutLanguage } from '../src/lib/notes/note-prompts.ts';

const ESTONIAN = 'Närvirakkude vahel liigub signaal sünapsi kaudu. Kui impulss jõuab aksoni lõppu, avanevad kaltsiumikanalid ja kaltsium siseneb rakku. See põhjustab virgatsaine vabanemise ning aine seondub järgmise raku retseptoritega. Signaal lõpeb, kui virgatsaine eemaldatakse. See on oluline, sest ilma kaltsiumita ei saa signaal edasi liikuda.';

for (const language of ['bs','hr','sr','sr-Cyrl','sl','en','et','fr','pl','am','zh-Hant']) {
  test(`${language} stays a content language independently of interface support`,()=>{
    assert.equal(normalizeNoteLanguage(language),language);
    assert.match(buildGeneratedContentLanguageInstruction(language),new RegExp(`detected source language is ${language}`));
  });
}
test('invalid and automatic hints stay unknown',()=>{
  for (const value of [null,'','auto','English','en<script>','und','mul']) assert.equal(normalizeContentLanguageCode(value),null);
  assert.equal(normalizeContentLanguageCode('SR_cyrl_RS'),'sr-Cyrl');
  assert.equal(normalizeSpokenLanguageCode('sr-Cyrl'),'sr');
});
test('Estonian overrides the historical Slovenian import default',()=>{
  assert.equal(resolveMaterialLanguage(ESTONIAN,'sl'),'et');
});
test('a compatible Bosnian hint survives ambiguous BCS prose',()=>{
  const shared='Ovo je primjer koji pokazuje što se događa kada se cijena promijeni jer nakon toga kupci žele manje proizvoda prema pravilima tržišta.';
  assert.equal(resolveMaterialLanguage(shared,'bs'),'bs');
});
test('Serbian Cyrillic is recognized and only its speech copy is transliterated',()=>{
  const written='Људске ћелије садрже једро. Његова улога је важна. ЏЕЗ и Ђак.';
  assert.equal(detectSourceLanguage(written),'sr-Cyrl');
  assert.equal(toSpeechScript(written,'sr-Cyrl'),'Ljudske ćelije sadrže jedro. Njegova uloga je važna. DŽEZ i Đak.');
  assert.equal(toSpeechScript(written,'ru'),written);
});
test('Estonian and all app languages have native speech, Amharic has English speech only',()=>{
  for (const code of ['et','bs','sr','hr','sl','en']) {
    assert.equal(resolveSpeechLanguage(code),code);
    assert.equal(needsEnglishSpeechFallback(code),false);
  }
  assert.equal(resolveSpeechLanguage('sr-Cyrl'),'sr');
  assert.equal(resolveSpeechLanguage('nb-NO'),'no');
  assert.equal(resolveSpeechLanguage('am'),'en');
  assert.equal(needsEnglishSpeechFallback('am'),true);
  assert.equal(normalizeNoteLanguage('am'),'am');
  assert.equal(SONIOX_LANGUAGES.size,60);
});
test('unknown-language callout examples explicitly require translation, including the script',()=>{
  for (const code of ['et','am']) assert.match(buildSourceNoteInstructions({outputLanguage:code}),/Translate each label naturally into the source language and script/);
  assert.match(buildSourceNoteInstructions({outputLanguage:'sr-Cyrl'}), /Кључно/);
  assert.match(buildSourceNoteInstructions({outputLanguage:'bs'}),/Use the exact localized callout labels/);
});
test('language sampling covers the body and tail, with a bounded model input',()=>{
  const text='English abstract. '.repeat(1000)+'Eesti õpiku tekst. '.repeat(1000)+'Lõppsõna.'.repeat(1000);
  const sampled=sampleSourceLanguage(text);
  assert.ok(sampled.includes('English abstract'));
  assert.ok(sampled.includes('Eesti õpiku'));
  assert.ok(sampled.endsWith('Lõppsõna.'));
  assert.ok(sampled.length<12100);
});

function loadResolver(generate) {
  const source=fs.readFileSync(new URL('../src/lib/source-language.ts',import.meta.url),'utf8').replace(/^import [\s\S]*?;\n/gm,'').replace('export async function','async function');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const entries=new Map();
  const checkpoint=async(p)=>{ const old=p.schema.safeParse(entries.get(p.cacheKey));if(old.success)return old.data;const result=p.schema.parse(await p.generate());entries.set(p.cacheKey,result);return result; };
  return new Function('generateStructuredObject','detectSourceLanguage','normalizeContentLanguageCode','resolveMaterialLanguage','generationCacheKey','stageModelCacheKeyPart','withGenerationCheckpoint','sampleSourceLanguage','sourceLanguageSchema','SOURCE_LANGUAGE_INSTRUCTIONS','isContradictedBySpelling','carriesNoLanguage',js+'\nreturn resolveSourceLanguage;')(generate,detectSourceLanguage,normalizeContentLanguageCode,resolveMaterialLanguage,generationCacheKey,()=> 'fixture-model',checkpoint,sampleSourceLanguage,sourceLanguageSchema,SOURCE_LANGUAGE_INSTRUCTIONS,isContradictedBySpelling,carriesNoLanguage);
}
test('the actual server resolver trusts matching metadata without a model call, but re-detects edits',async()=>{
  let calls=0;
  const resolve=loadResolver(async()=>{calls++;return {language:'et'};});
  const metadata={sourceLanguage:{version:1,code:'bs',notesHash:generationCacheKey(['Original'])}};
  assert.equal(await resolve({text:'Original',metadata}),'bs');
  assert.equal(calls,0);
  assert.equal(await resolve({text:ESTONIAN,metadata,hint:'sl',lectureId:'fixture'}),'et');
  assert.equal(calls,1);
  await resolve({text:ESTONIAN,metadata,hint:'sl',lectureId:'fixture'});
  assert.equal(calls,1);
});
// A photographed history textbook page that production labelled Estonian on 2026-09-17.
const SLOVENIAN_SCAN = 'Poleg navigacijskih inštrumentov je daljše plovbe omogočil tudi napredek v razvoju ladij. Pomembno vlogo pri čezoceanskih potovanjih so imele nove ladje - karavele, ki so uveljavile v 15. stoletju. Pri odkrivanju novih pomorskih poti v Azijo so imeli pomembno vlogo vladarji. Prvi je pomembnost novih poti spoznal portugalski princ Henrik Pomorščak.';

test('Estonian needs its own letters; Slovenian without them is never Estonian',()=>{
  assert.equal(isContradictedBySpelling('et',SLOVENIAN_SCAN),true);
  assert.equal(isContradictedBySpelling('et',ESTONIAN),false);
  assert.equal(isContradictedBySpelling('sl',SLOVENIAN_SCAN),false);
  assert.equal(isContradictedBySpelling('et','Kaj je to?'),false);
});
test('the prompt names Slovenian and tells it apart from Estonian by its letters',()=>{
  assert.match(SOURCE_LANGUAGE_INSTRUCTIONS,/Slovenian is sl \(never et or sk\)/);
  assert.match(SOURCE_LANGUAGE_INSTRUCTIONS,/Estonian writes õ, ä, ö, ü/);
});
test('a model answer of Estonian for Slovenian material is asked again, not trusted',async()=>{
  const prompts=[];
  const resolve=loadResolver(async(p)=>{prompts.push(p.instructions);return {language:prompts.length===1?'et':'sl'};});
  assert.equal(await resolve({text:SLOVENIAN_SCAN,hint:'et',lectureId:'fixture'}),'sl');
  assert.equal(prompts.length,2);
  assert.match(prompts[1],/not et/);
});
test('a stored Estonian label on Slovenian material is re-detected instead of reused',async()=>{
  let calls=0;
  const resolve=loadResolver(async()=>{calls++;return {language:'sl'};});
  const metadata={sourceLanguage:{version:1,code:'et',notesHash:generationCacheKey([SLOVENIAN_SCAN])}};
  assert.equal(await resolve({text:SLOVENIAN_SCAN,metadata,hint:'et'}),'sl');
  assert.equal(calls,1);
});
test('a model that insists on Estonian falls back to the material, never the stale et hint',async()=>{
  const resolve=loadResolver(async()=>({language:'et'}));
  assert.notEqual(await resolve({text:SLOVENIAN_SCAN,hint:'et'}),'et');
});
// A photographed algebra exercise (PR #537) has no language to detect. The model answered en, so a
// Slovenian learner got an English note, or a Slovenian body under an English title and summary.
const FORMULAS_ONLY = 'a) (7x - 3y)^5 · (6y - 14x)^3 =\nb) (2a + 5b)^3 · (4b - 10a)^2 =';

test('formulas alone carry no language; one written word does',()=>{
  assert.equal(carriesNoLanguage(FORMULAS_ONLY),true);
  assert.equal(carriesNoLanguage('x^4 · x^3 : x^2 = x^5'),true);
  assert.equal(carriesNoLanguage('√16 · 2² = 8'),true);
  assert.equal(carriesNoLanguage('(3m^2 n)^3 · (2mn^2)^2 ='),true);
  // Trigonometry and calculus are notation too; the model called both English.
  assert.equal(carriesNoLanguage('sin^2 x + cos^2 x = 1\ntan x = sin x / cos x'),true);
  assert.equal(carriesNoLanguage('lim (x→0) sin x / x = ?\nlog_2 8 = ?\nln(e^2) ='),true);
  assert.equal(carriesNoLanguage('arctg x + ctg x · sinh(2x)'),true);
  // A real word among the notation is language evidence again, and the model decides.
  assert.equal(carriesNoLanguage('Izračunaj sin 30°'),false);
  assert.equal(carriesNoLanguage('Find the minimum of x^2 - 4x'),false);
  assert.equal(carriesNoLanguage('Logaritmi: log_2 8 ='),false);
  assert.equal(carriesNoLanguage('Izračunaj: 3x + 4 = 19'),false);
  assert.equal(carriesNoLanguage('Solve 3x + 4 = 19'),false);
});
test('formulas alone are written in the learner\'s language, without asking the model',async()=>{
  let calls=0;
  const resolve=loadResolver(async()=>{calls++;return {language:'en'};});
  assert.equal(await resolve({text:FORMULAS_ONLY,learnerLanguage:'sl',lectureId:'fixture'}),'sl');
  assert.equal(await resolve({text:FORMULAS_ONLY,learnerLanguage:'hr',lectureId:'fixture'}),'hr');
  // The prompt's order: a valid hint from the import still comes first.
  assert.equal(await resolve({text:FORMULAS_ONLY,hint:'bs',learnerLanguage:'sl',lectureId:'fixture'}),'bs');
  assert.equal(calls,0);
  // Without a known learner language nothing changes: the model decides, as before.
  assert.equal(await resolve({text:FORMULAS_ONLY,lectureId:'fixture'}),'en');
  assert.equal(calls,1);
});
test('the learner\'s language never overrides material written in a language',async()=>{
  const inputs=[];
  const resolve=loadResolver(async(p)=>{inputs.push(JSON.parse(p.input));return {language:'en'};});
  assert.equal(await resolve({text:'Solve for x: 3x + 4 = 19',learnerLanguage:'sl',lectureId:'fixture'}),'en');
  assert.equal(inputs[0].learnerLanguage,'sl');
  assert.match(SOURCE_LANGUAGE_INSTRUCTIONS,/learnerLanguage[^.]*never outweighs any language the material is written in/);
  // Callers that do not know the learner send the same input as before, so cached answers hold.
  await resolve({text:'Rešimo enačbo 3x + 4 = 19',lectureId:'fixture'});
  assert.deepEqual(Object.keys(inputs[1]),['hint','material']);
});
test('notes ask for the learner\'s app language, and survive not getting it',()=>{
  const source=fs.readFileSync(new URL('../src/lib/note-generation.ts',import.meta.url),'utf8');
  assert.match(source,/learnerLanguage: await readLearnerLanguage\(params\.usageContext\?\.userId\)/);
  assert.match(source,/async function readLearnerLanguage[\s\S]*?try \{\s*return await readProfileLocale\(userId\);\s*\} catch/);
});
test('provider failure on unknown material never silently changes it to English or an old hint',async()=>{
  const resolve=loadResolver(async()=>{throw Error('provider unavailable');});
  await assert.rejects(resolve({text:'አማርኛ የጥናት ማስታወሻ',hint:'sl'}),/provider unavailable/);
});

test('Serbian script changes cannot turn leaked tutor audio into an interruption',()=>{
  assert.equal(judgeHeard('Калцијум улази у ћелију','Kalcijum ulazi u ćeliju','sr-Cyrl'),'tutor');
  assert.equal(judgeHeard('Синапса','Sinapsa','sr'),'tutor');
  assert.equal(judgeHeard('Чекај, зашто је то важно?','Kalcijum ulazi u ćeliju','sr-Cyrl'),'learner');
  assert.equal(judgeHeard('Калцијум улази у ћелију','','sr-Cyrl'),'learner');
});

function loadWrittenRepair(generate) {
  const source = fs.readFileSync(new URL('../src/lib/ai/language-check.ts', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/export /g, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const entries = new Map();
  const checkpoint = async (p) => {
    if (entries.has(p.cacheKey)) return entries.get(p.cacheKey);
    const result = p.schema.parse(await p.generate());
    entries.set(p.cacheKey, result);
    return result;
  };
  return import('../src/lib/ai/language-repair.ts').then(repair => {
    const dependencies = {
      ...repair, generateStructuredObject: generate, isLanguageCheckEnabled: () => true,
      getCurrentAbortSignal: () => undefined, getRemainingBudgetMs: () => undefined,
      runWithAbortSignal: (_signal, call) => call(), generationCacheKey,
      stageModelCacheKeyPart: () => 'test-model', withGenerationCheckpoint: checkpoint,
    };
    return new Function(...Object.keys(dependencies), js + '\nreturn repairWrittenNote;')(...Object.values(dependencies));
  });
}

test('written corrections preserve markdown, reuse checkpoints, and leave English alone', async () => {
  let calls = 0;
  const repair = await loadWrittenRepair(async p => {
    calls++;
    return { corrected: JSON.parse(p.input).textToCorrect.replace('between', 'između') };
  });
  const text = '## Sinapsa\n\nPrijenos signala between dvije ćelije.\n';
  const params = { text, language: 'bs', usageContext: { lectureId: 'fixture' } };
  assert.equal(await repair(params), text.replace('between', 'između'));
  assert.equal(await repair(params), text.replace('between', 'između'));
  assert.equal(calls, 1);
  assert.equal(await repair({ ...params, language: 'en' }), text);
  assert.equal(calls, 1);
});

test('a failed or rewriting proofreader cannot erase a successfully generated note', async () => {
  const text = '## Sinapsa\n\nKalcij ulazi u ćeliju i pokreće oslobađanje neurotransmitera.\n';
  const failed = await loadWrittenRepair(async () => { throw Error('test outage'); });
  assert.equal(await failed({ text, language: 'bs' }), text);
  const rewritten = await loadWrittenRepair(async () => ({ corrected: '## Novi sadržaj\n\nPotpuno druga tema.' }));
  assert.equal(await rewritten({ text, language: 'bs' }), text);
});


test('foreign callout examples cannot leak into native notes, and code samples stay unchanged', () => {
  const text = '> **Key takeaway:** Ilma kaltsiumita virgatsaine ei vabane.\n';
  assert.equal(normalizeNoteCalloutLanguage(text, 'et'), '> Ilma kaltsiumita virgatsaine ei vabane.\n');
  assert.equal(normalizeNoteCalloutLanguage(text, 'en'), text);
  assert.equal(normalizeNoteCalloutLanguage('> **Key takeaway:** Калцијум је неопходан.', 'sr-Cyrl'), '> **Кључно:** Калцијум је неопходан.');
  const code = '```md\n' + text + '```';
  assert.equal(normalizeNoteCalloutLanguage(code, 'et'), code);
  assert.equal(normalizeNoteCalloutLanguage('> **Peamine järeldus:** Eesti tekst.', 'et'), '> **Peamine järeldus:** Eesti tekst.');
});
