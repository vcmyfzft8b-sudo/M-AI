import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { normalizeContentLanguageCode, normalizeNoteLanguage, normalizeSpokenLanguageCode, resolveMaterialLanguage, detectSourceLanguage, buildGeneratedContentLanguageInstruction } from '../src/lib/languages.ts';
import { judgeHeard } from '../src/lib/tutor/turn-audio.ts';
import { SONIOX_LANGUAGES, resolveSpeechLanguage, needsEnglishSpeechFallback, toSpeechScript } from '../src/lib/speech-language.ts';
import { sourceLanguageSchema, sampleSourceLanguage, SOURCE_LANGUAGE_INSTRUCTIONS } from '../src/lib/source-language-policy.ts';
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
  const source=fs.readFileSync(new URL('../src/lib/source-language.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const entries=new Map();
  const checkpoint=async(p)=>{ const old=p.schema.safeParse(entries.get(p.cacheKey));if(old.success)return old.data;const result=p.schema.parse(await p.generate());entries.set(p.cacheKey,result);return result; };
  return new Function('generateStructuredObject','detectSourceLanguage','normalizeContentLanguageCode','resolveMaterialLanguage','generationCacheKey','stageModelCacheKeyPart','withGenerationCheckpoint','sampleSourceLanguage','sourceLanguageSchema','SOURCE_LANGUAGE_INSTRUCTIONS',js+'\nreturn resolveSourceLanguage;')(generate,detectSourceLanguage,normalizeContentLanguageCode,resolveMaterialLanguage,generationCacheKey,()=> 'fixture-model',checkpoint,sampleSourceLanguage,sourceLanguageSchema,SOURCE_LANGUAGE_INSTRUCTIONS);
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
