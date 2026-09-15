"""Reusable speech cleanup and measured, word-highlighted captions. No API calls.

Plan: speech_edit.py plan transcript.json --duration 40 --source S01 -o plan.json
Captions: speech_edit.py captions edl.json --edit-dir edit -o edit/master.ass
"""
import argparse
import json
import math
import re
import sys
import subprocess
from pathlib import Path


def words_from(transcript, duration=None):
    raw = transcript.get('words', [])
    words = []
    for item in raw:
        if item.get('type', 'word') != 'word' or not item.get('text', '').strip():
            continue
        a, b = float(item['start']), float(item['end'])
        if not all(map(math.isfinite, (a, b))) or a < 0 or b <= a or (duration is not None and b > duration + .001):
            raise ValueError('Invalid word timestamps')
        if words and a < words[-1]['end'] - .001:
            raise ValueError('Overlapping speech needs speaker-specific alignment before cleanup/captions')
        words.append({**item, 'start': a, 'end': b, 'text': item['text'].strip(), 'index': len(words)})
    if not words:
        raise ValueError('Word-level transcript required; never guess speech boundaries')
    return words


def repetition_candidates(words):
    """Exact adjacent phrases only. Candidates require a semantic decision, never auto-delete."""
    norm = lambda text: ''.join(c for c in text.casefold() if c.isalnum())
    tokens = [norm(w['text']) for w in words]
    result, occupied = [], set()
    for n in range(12, 2, -1):
        for i in range(len(words) - 2*n + 1):
            if any(j in occupied for j in range(i, i+2*n)):
                continue
            if tokens[i:i+n] != tokens[i+n:i+2*n] or not all(tokens[i:i+n]):
                continue
            if words[i+n]['start'] - words[i+n-1]['end'] > 3:
                continue
            if len({w.get('speaker_id') for w in words[i:i+2*n]}) != 1:
                continue
            result.append({'id': f'repeat-{i}-{n}', 'remove_word_indices': list(range(i, i+n)),
                           'keep_word_indices': list(range(i+n, i+2*n)),
                           'text': ' '.join(w['text'] for w in words[i:i+n]),
                           'requires_semantic_review': True})
            occupied.update(range(i, i+2*n))
    return result


def plan_cleanup(transcript, duration, source='S01', approved_repetitions=(), protected=(),
                 min_gap=.65, keep_pause=.28, trim_silences=True, silent_intervals=None):
    if not math.isfinite(duration) or duration <= 0 or duration > 600:
        raise ValueError('Duration must be 0–600 seconds')
    if not (.4 <= min_gap <= 3 and .15 <= keep_pause <= .6 and keep_pause < min_gap):
        raise ValueError('Unsafe pause settings')
    words = words_from(transcript, duration)
    candidates = repetition_candidates(words)
    chosen = set(approved_repetitions)
    if chosen - {c['id'] for c in candidates}:
        raise ValueError('Unknown repetition candidate')
    protection = list(protected)
    for event in transcript.get('words', []):
        if event.get('type') in ('audio_event', 'event'):
            protection.append({'start': event['start'], 'end': event['end']})
    for p in protection:
        if not all(math.isfinite(float(p[k])) for k in ('start','end')) or not 0 <= p['start'] < p['end'] <= duration:
            raise ValueError('Invalid protected interval')
    def protected_cut(a, b):
        return any(p['start'] < b and p['end'] > a for p in protection)
    cuts, removed = [], set()
    for c in candidates:
        if c['id'] not in chosen:
            continue
        indices = c['remove_word_indices']; first, last = indices[0], indices[-1]
        a = 0 if first == 0 else words[first-1]['end']+.14
        b = words[last+1]['start']-.10
        if (first and a > words[first]['start']-.03) or b < words[last]['end']+.03:
            raise ValueError('Repetition has no safe padded cut; retain it')
        if protected_cut(a,b):
            raise ValueError('Repetition intersects protected material')
        cuts.append({'start': a,'end': b,'reason': c['id']});removed.update(indices)
    if trim_silences:
        # Preserve turn-taking air and punctuation pauses. No filler-word deletions.
        for left, right in zip(words, words[1:]):
            if left['index'] in removed or right['index'] in removed:
                continue
            gap = right['start']-left['end']
            turn = left.get('speaker_id') != right.get('speaker_id')
            pause = max(keep_pause, .45 if turn or re.search(r'[.!?…]$', left['text']) else keep_pause)
            if gap < max(min_gap, pause+.10):
                continue
            a,b = left['end']+pause/2, right['start']-pause/2
            if silent_intervals is not None:
                # Silence evidence restricts the ASR proposal. Never cut an
                # untranscribed breath/word merely because ASR left a gap.
                intersections=[(max(a,p['start']+.03),min(b,p['end']-.03)) for p in silent_intervals]
                intersections=[(x,y) for x,y in intersections if y-x>=.10]
                if not intersections:continue
                a,b=max(intersections,key=lambda interval:interval[1]-interval[0])
            if not protected_cut(a,b):
                cuts.append({'start':a,'end':b,'reason':'long_pause'})
    cuts.sort(key=lambda c:c['start'])
    ranges=[];cursor=0
    for c in cuts:
        if c['start'] < cursor:
            raise ValueError('Overlapping cleanup operations')
        if c['start'] > cursor:
            ranges.append({'source':source,'start':round(cursor,6),'end':round(c['start'],6)})
        cursor=c['end']
    if cursor < duration:
        ranges.append({'source':source,'start':round(cursor,6),'end':duration})
    # Verify preserved words exactly once, no partial word and usable segment lengths.
    kept=[]
    for r in ranges:
        if r['end']-r['start'] < .15:
            raise ValueError('Cleanup would create an unusably short segment')
        for w in words:
            if w['start'] < r['end']-.001 and w['end'] > r['start']+.001:
                if w['start'] < r['start']-.001 or w['end'] > r['end']+.001:
                    raise ValueError('Cleanup cuts a word')
                kept.append(w['index'])
    if kept != [w['index'] for w in words if w['index'] not in removed]:
        raise ValueError('Narration coverage mismatch')
    total=sum(r['end']-r['start'] for r in ranges)
    return {'ranges':ranges,'total_duration_s':total,'removed_seconds':duration-total,
            'cuts':cuts,'repetition_candidates':candidates,'approved_repetitions':sorted(chosen),
            'kept_word_indices':kept,'removed_word_indices':sorted(removed),
            'silence_evidence':'audio_and_words' if silent_intervals is not None else 'words_only_requires_audio_review',
            'review_required':['Listen at every cut for breath/ASR drift','Check visual continuity at every cut']}


def detect_silences(path, duration):
    run=subprocess.run(['ffmpeg','-hide_banner','-nostdin','-i',str(path),'-vn',
                        '-af','silencedetect=noise=-38dB:d=0.25','-f','null','-'],
                       capture_output=True,text=True,check=True,timeout=60)
    result=[];start=None
    for kind,value in re.findall(r'silence_(start|end):\s*([\d.]+)',run.stderr):
        if kind=='start':start=float(value)
        elif start is not None:
            result.append({'start':start,'end':min(duration,float(value))});start=None
    if start is not None and start<duration:result.append({'start':start,'end':duration})
    return result


def mapped_words(edl, edit_dir):
    result=[];offset=0
    for segment, r in enumerate(edl['ranges']):
        path=Path(edit_dir)/'transcripts'/f"{r['source']}.json"
        transcript=json.loads(path.read_text())  # Missing transcript must not silently lose captions.
        words=words_from(transcript)
        a,b=float(r['start']),float(r['end']);offset=float(r.get('rendered_start',offset))
        duration=float(r.get('rendered_duration',b-a))
        for w in words:
            if w['end'] <= a or w['start'] >= b:
                continue
            if w['start'] < a-.001 or w['end'] > b+.001:
                raise ValueError('Caption source range cuts a word')
            start=offset+w['start']-a;end=offset+w['end']-a
            if end > offset+duration+.011:
                raise ValueError('Encoded segment truncates a spoken word')
            if result and start < result[-1]['end']-.001:
                raise ValueError('Caption output times overlap')
            result.append({**w,'source':r['source'],'segment':segment,'start':start,'end':end})
        offset+=duration
    return result


def build_dynamic_ass(edl, edit_dir, out_path):
    from PIL import ImageFont
    words=mapped_words(edl,edit_dir)
    width,height=(edl.get('output',{}).get(k,v) for k,v in [('width',1080),('height',1920)])
    options=edl.get('dynamic_captions',{})
    if not isinstance(options,dict) or set(options)-{'color','highlight','font_size','max_words','bottom_fraction'}:
        raise ValueError('Unknown dynamic caption settings')
    size=int(options.get('font_size',round(min(width*.075,height*.06))))
    maximum=int(options.get('max_words',4));bottom=float(options.get('bottom_fraction',.19))
    if not 12 <= size <= min(width*.15,height*.15) or not 1 <= maximum <= 7 or not .1 <= bottom <= .35:
        raise ValueError('Unsafe caption dimensions')
    font_path=Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf') if sys.platform=='darwin' else Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
    font=ImageFont.truetype(str(font_path),size)
    family='Arial' if sys.platform=='darwin' else 'DejaVu Sans'
    margin=math.ceil(width*.09);usable=width-2*margin-2*max(2,round(size*.06))
    def color(value):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise ValueError('Invalid caption color')
        return '&H00'+value[5:7]+value[3:5]+value[1:3]
    primary=color(options.get('color','#ffffff'));highlight=color(options.get('highlight','#ffdf00'))
    def text(w):
        value=w['text'].upper() if edl.get('caption_case')=='upper' else w['text']
        return value.replace('\\','＼').replace('{','｛').replace('}','｝').replace('\n',' ').replace('\r',' ')
    def layout(group):
        lines=[[]]
        for w in group:
            if font.getlength(text(w))>usable:raise ValueError('Word exceeds safe width; choose smaller caption font')
            if lines[-1] and font.getlength(' '.join(text(x) for x in lines[-1]+[w]))>usable:lines.append([])
            lines[-1].append(w)
        return lines
    groups=[];current=[]
    for w in words:
        if current and (w['segment']!=current[-1]['segment'] or w.get('speaker_id')!=current[-1].get('speaker_id') or
                        w['start']-current[-1]['end']>.35 or len(current)>=maximum or
                        re.search(r'[,;:.!?…]$',current[-1]['text']) or len(layout(current+[w]))>2):
            groups.append(current);current=[]
        current.append(w)
    if current:groups.append(current)
    def stamp(cs):
        h,remain=divmod(cs,360000);m,remain=divmod(remain,6000);s,c=divmod(remain,100)
        return f'{h}:{m:02}:{s:02}.{c:02}'
    def escape(t):
        # ASS override injection and line-break escapes cannot come from ASR.
        return t.replace('\\','＼').replace('{','｛').replace('}','｝').replace('\n',' ').replace('\r',' ')
    header=f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{family},{size},{primary},{primary},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,{max(2,round(size*.06))},0,2,{margin},{margin},{round(height*bottom)},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    events=[];audit=[];excluded=[];last_end=0
    for gi,group in enumerate(groups):
        start,end=group[0]['start'],group[-1]['end']
        if any(x['start']<end and x['end']>start for x in edl.get('caption_exclusions',[])):
            excluded.extend({'source':w['source'],'index':w['index'],'segment':w['segment']} for w in group);continue
        lines=layout(group)
        if len(lines)>2:raise ValueError('Caption exceeds two lines')
        # One stable phrase layout; only color changes, never reflow or word animation.
        times=sorted(set(round(t*100) for w in group for t in (w['start'],w['end'])))
        if times[0]<last_end:raise ValueError('Rounded captions overlap')
        for w in group:
            if round(w['end']*100)<=round(w['start']*100):raise ValueError('Word shorter than ASS precision')
        for a,b in zip(times,times[1:]):
            midpoint=(a+b)/200
            value=r'\N'.join(' '.join('{\\c'+(highlight if w['start']<=midpoint<w['end'] else primary)+'&}'+escape(text(w)) for w in line) for line in lines)
            events.append(f'Dialogue: 0,{stamp(a)},{stamp(b)},Default,,0,0,0,,{value}')
        last_end=times[-1]
        cps=sum(len(text(w)) for w in group)/max(.01,end-start)
        audit.append({'group':gi,'start':start,'end':end,'text':' '.join(text(w) for w in group),
                      'lines':[' '.join(text(w) for w in line) for line in lines],
                      'widths':[round(font.getlength(' '.join(text(w) for w in line)),2) for line in lines],
                      'words':[{'source':w['source'],'index':w['index'],'segment':w['segment'],'start':w['start'],'end':w['end']} for w in group],
                      'reading_speed_warning':cps>25})
    Path(out_path).write_text(header+'\n'.join(events)+'\n')
    report={'version':1,'groups':audit,'excluded_words':excluded,'word_count':len(words),
            'safe_width':usable,'font_path':str(font_path),'font_size':size,'events':len(events),
            'timing_tolerance_seconds':.01,'visual_review_required':True}
    Path(out_path).with_suffix('.audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['plan','plan-request','captions']);p.add_argument('input',type=Path)
    p.add_argument('-o','--output',required=True,type=Path);p.add_argument('--duration',type=float);p.add_argument('--source',default='S01')
    p.add_argument('--approve-repeat',action='append',default=[]);p.add_argument('--edit-dir',type=Path)
    p.add_argument('--audio',type=Path)
    a=p.parse_args();data=json.loads(a.input.read_text())
    if a.mode in ('plan','plan-request'):
        if a.mode=='plan-request':
            media=data.pop('source_media',None)
            if media:data['silent_intervals']=detect_silences(media,data['duration'])
            result=plan_cleanup(**data)
        else:
            result=plan_cleanup(data,a.duration,a.source,a.approve_repeat,
                                silent_intervals=detect_silences(a.audio,a.duration) if a.audio else None)
        a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    else:build_dynamic_ass(data,a.edit_dir or a.input.parent,a.output)
