import unittest, sys, tempfile, json, random
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'workers/video-use/vendor/helpers'))
from speech_edit import plan_cleanup, words_from, build_dynamic_ass, mapped_words

def word(text,a,b,**kw):return dict(type='word',text=text,start=a,end=b,**kw)

class SpeechEditTest(unittest.TestCase):
 def test_cleanup_preserves_all_words_and_sentence_breath(self):
  t={'words':[word('Hola.',.2,.5),word('Mundo',2,2.5),word('bien',2.65,3)]}
  p=plan_cleanup(t,4)
  self.assertEqual(p['kept_word_indices'],[0,1,2]);self.assertEqual(p['removed_word_indices'],[])
  self.assertAlmostEqual(p['removed_seconds'],1.05)
  self.assertGreaterEqual(p['ranges'][0]['end']-.5,.2)
 def test_protected_events_and_actions(self):
  t={'words':[word('Hola',.2,.5),{'type':'audio_event','text':'laugh','start':.7,'end':1.2},word('bien',2,2.5)]}
  self.assertEqual(plan_cleanup(t,3)['removed_seconds'],0)
  t['words'].pop(1)
  self.assertEqual(plan_cleanup(t,3,protected=[{'start':.6,'end':1.9}])['removed_seconds'],0)
 def test_audio_gate_protects_untranscribed_sound(self):
  t={'words':[word('hola',.2,.5),word('bien',2,2.5)]}
  self.assertEqual(plan_cleanup(t,3,silent_intervals=[])['removed_seconds'],0)
  p=plan_cleanup(t,3,silent_intervals=[{'start':1,'end':1.6}])
  self.assertAlmostEqual(p['removed_seconds'],.54)
  self.assertEqual(p['silence_evidence'],'audio_and_words')
 def test_no_removal_of_rhetorical_repeats_without_selection(self):
  t={'words':[word(x,.3+i*.55,.55+i*.55) for i,x in enumerate(['Esto','es','bueno','Esto','es','bueno'])]}
  p=plan_cleanup(t,4);self.assertEqual(len(p['repetition_candidates']),1)
  self.assertEqual(p['removed_word_indices'],[])
  p=plan_cleanup(t,4,approved_repetitions=[p['repetition_candidates'][0]['id']])
  self.assertEqual(p['kept_word_indices'],[3,4,5]);self.assertEqual(p['removed_word_indices'],[0,1,2])
  with self.assertRaises(ValueError):plan_cleanup(t,4,approved_repetitions=['invented'])
 def test_turns_and_overlaps(self):
  t={'words':[word('sí',.2,.5,speaker_id='a'),word('bien',2,2.5,speaker_id='b')]}
  p=plan_cleanup(t,3);self.assertAlmostEqual(p['removed_seconds'],1.05)
  with self.assertRaises(ValueError):words_from({'words':[word('a',0,1),word('b',.5,1.2)]})
 def test_randomized_word_coverage_and_padding(self):
  rng=random.Random(912)
  for case in range(150):
   t={'words':[]};now=.2
   for i in range(30):
    end=now+rng.uniform(.06,.5);t['words'].append(word(str(i),now,end));now=end+rng.uniform(.05,1.8)
   p=plan_cleanup(t,now+.2)
   self.assertEqual(p['kept_word_indices'],list(range(30)))
   for cut in p['cuts']:
    self.assertFalse(any(w['start']<cut['end'] and w['end']>cut['start'] for w in t['words']))
 def captions(self,words,edl=None):
  td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup);p=Path(td.name);(p/'transcripts').mkdir()
  (p/'transcripts/S01.json').write_text(json.dumps({'words':words}))
  e=edl or {'ranges':[{'source':'S01','start':0,'end':5}], 'output':{'width':720,'height':1280},'dynamic_captions':{}}
  return build_dynamic_ass(e,p,p/'master.ass'),(p/'master.ass').read_text(),p
 def test_dynamic_words_have_stable_layout_and_safe_width(self):
  ws=[word('Lo',.1,.3),word('que',.34,.5),word('realmente',.55,1.1),word('importa.',1.12,1.5),word('México',2,2.5)]
  r,ass,p=self.captions(ws)
  self.assertEqual(sum(len(g['words']) for g in r['groups']),5)
  self.assertTrue(all(len(g['lines'])<=2 and max(g['widths'])<=r['safe_width'] for g in r['groups']))
  self.assertIn('\\c&H0000dfff&',ass);self.assertIn('PlayResX: 720',ass)
  self.assertTrue(any('realmente' in g['text'] for g in r['groups']))
 def test_measured_offsets_and_no_group_crosses_cut(self):
  e={'ranges':[{'source':'S01','start':0,'end':1,'rendered_start':0,'rendered_duration':1.04},{'source':'S01','start':2,'end':3,'rendered_start':1.04,'rendered_duration':1.04}], 'output':{'width':720,'height':1280}}
  r,_,_=self.captions([word('Hola',.2,.6),word('bien',2.2,2.6)],e)
  self.assertEqual(len(r['groups']),2);self.assertAlmostEqual(r['groups'][1]['start'],1.24)
 def test_ass_injection_and_long_words_fail_closed(self):
  r,ass,_=self.captions([word(r'{\pos(0,0)}hola',.2,1)])
  self.assertNotIn(r'{\pos(0,0)}',ass)
  with self.assertRaises(ValueError):self.captions([word('W'*150,.2,1)])
 def test_exclusions_report_omitted_words_and_precision(self):
  e={'ranges':[{'source':'S01','start':0,'end':3}],'output':{'width':720,'height':1280},'caption_exclusions':[{'start':0,'end':1}]}
  r,ass,_=self.captions([word('hello',.2,.5),word('world',1.5,2)],e)
  self.assertEqual(len(r['excluded_words']),1);self.assertEqual(len(r['groups']),1)
  with self.assertRaises(ValueError):self.captions([word('tiny',.2001,.2002)])
 def test_missing_transcript_fails_not_silent(self):
  with tempfile.TemporaryDirectory() as p:
   with self.assertRaises(FileNotFoundError):mapped_words({'ranges':[{'source':'bad','start':0,'end':1}]},p)

if __name__=='__main__':unittest.main()
