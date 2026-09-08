import unittest,sys,tempfile,json,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'workers/video-use/vendor/helpers'))
import render
class TimelineTest(unittest.TestCase):
 def test_mapping_preserves_words_and_moves_overlays(self):
  e={'sources':{'S01':'x'},'ranges':[{'source':'S01','start':0,'end':.17} for _ in range(20)],'overlays':[{'start_in_output':3.23,'duration':.17}]}
  d=render.measured_timeline(e,[5/24]*20,20*5/24+.0213)
  self.assertAlmostEqual(e['ranges'][-1]['rendered_start'],19*5/24)
  self.assertAlmostEqual(e['overlays'][0]['start_in_output'],19*5/24)
  self.assertEqual(e['ranges'][-1]['end'],.17)
  with self.assertRaises(ValueError):render.measured_timeline({'ranges':[{'start':0,'end':1}]},[2],2)
 def test_caption_window_remaps_and_suppresses_only_redundant_text(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);(p/'transcripts').mkdir();(p/'transcripts/S01.json').write_text(json.dumps({'words':[{'type':'word','text':'Hello','start':.03,'end':.14}]}))
   e={'sources':{'S01':'x'},'ranges':[{'source':'S01','start':0,'end':.17} for _ in range(3)],'caption_exclusions':[{'start':.17,'end':.34}]}
   render.measured_timeline(e,[5/24]*3,15/24)
   render.build_master_srt(e,p,p/'master.srt')
   self.assertEqual((p/'master.srt').read_text().count('Hello'),2)
   self.assertAlmostEqual(e['caption_exclusions'][0]['start'],5/24)

 def test_actual_many_cut_export_and_caption_alignment(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);(p/'transcripts').mkdir()
   def cmd(a):subprocess.run(a,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
   cmd(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=blue:s=128x128:r=24:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:v','libx264','-c:a','aac',str(p/'source.mp4')])
   cmd(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=green:s=128x128:r=24:d=8','-c:v','libx264',str(p/'overlay.mp4')])
   (p/'transcripts/S01.json').write_text(json.dumps({'words':[{'type':'word','text':'Hello','start':.03,'end':.14}]}))
   edl={'sources':{'S01':str(p/'source.mp4')},'ranges':[{'source':'S01','start':0,'end':.17} for _ in range(20)],'overlays':[{'file':'overlay.mp4','start_in_output':1,'duration':.2}],'output':{'width':128,'height':128,'fps':24},'grade':'none','subtitles':'master.srt'}
   (p/'edl.json').write_text(json.dumps(edl))
   cmd([sys.executable,render.__file__,str(p/'edl.json'),'-o',str(p/'out.mp4'),'--preview','--build-subtitles','--no-loudnorm'])
   timeline=json.loads((p/'rendered-timeline.json').read_text())
   self.assertLess(abs(render.media_duration(p/'out.mp4')-timeline['duration']),.1)
   self.assertLess(render.media_duration(p/'out.mp4'),5,'Long overlay must not extend base')
   expected=render._srt_timestamp(timeline['ranges'][-1]['output_start']+.03)
   self.assertIn(expected,(p/'master.srt').read_text())
if __name__=='__main__':unittest.main()
