"""Exercise real decoders/rendered pixels and audio, plus project boundaries."""
import array
import io
import json
import math
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from typing import get_args
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.core import db
from engine.core.routes import router as core_router
from engine.studio.editor_models import Animation, Project, TimelineItem
from engine.studio.editor_media import editor_media, probe_media, validate_project_media
from engine.studio.editor_render import interpolate, render_project, visual_expression
from engine.studio.editor_routes import router
from engine.studio.media import ffmpeg_binary


class EditorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures=tempfile.TemporaryDirectory()
        cls.ffmpeg=ffmpeg_binary()
        cls.red=Path(cls.fixtures.name)/'red.mp4'
        cls.blue=Path(cls.fixtures.name)/'blue.mp4'
        for target,color,freq in ((cls.red,'red',440),(cls.blue,'blue',880)):
            subprocess.run([cls.ffmpeg,'-v','error','-y','-f','lavfi','-i',f'color={color}:s=160x90:r=30:d=3','-f','lavfi','-i',f'sine=frequency={freq}:sample_rate=48000:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-t','3',str(target)],check=True)
    @classmethod
    def tearDownClass(cls): cls.fixtures.cleanup()
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.folder=Path(self.temporary.name)
        self.db_patch=patch.object(db,'DATA_DIR',self.folder); self.db_patch.start()
        self.clip=self.add_clip('owned'); self.other=self.add_clip('owned'); self.unknown=self.add_clip('unknown')
        self.source=self.add_media(self.clip,self.red,'source')
        self.blue_asset=self.add_media(self.clip,self.blue,'video')
        app=FastAPI(); app.include_router(router); app.include_router(core_router)
        self.client=TestClient(app)
    def tearDown(self):
        self.client.close(); self.db_patch.stop(); self.temporary.cleanup()
    def add_clip(self,status):
        identity=str(uuid4())
        with db.connect() as connection:
            connection.execute('INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)',(identity,'My movie',status,db.now()))
        return identity
    def add_media(self,clip,source,kind):
        import shutil
        path=self.folder/(str(uuid4())+source.suffix); shutil.copyfile(source,path)
        return db.add_asset(clip,kind,path)
    def item(self,**values):
        return TimelineItem.model_validate({'id':'video','kind':'video','asset_id':self.source['id'],'name':'Red','duration':2,**values})
    def project(self,*items): return Project(width=1080,height=1080,items=list(items))
    def render(self,project):
        output=self.folder/(str(uuid4())+'.mp4')
        result=render_project(project,validate_project_media(self.clip,project),output,480)
        self.assertTrue(output.is_file()); self.assertEqual(result['width'],480)
        return output
    def pixels(self,path,time):
        result=subprocess.run([self.ffmpeg,'-v','error','-ss',str(time),'-i',str(path),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
        self.assertEqual(len(result.stdout),480*480*3)
        return result.stdout
    def pixel(self,frame,x,y): return tuple(frame[(y*480+x)*3:(y*480+x)*3+3])
    def rms(self,path,start,duration=.1):
        result=subprocess.run([self.ffmpeg,'-v','error','-ss',str(start),'-i',str(path),'-t',str(duration),'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1'],capture_output=True,check=True)
        values=array.array('f'); values.frombytes(result.stdout)
        return math.sqrt(sum(v*v for v in values)/max(1,len(values)))

    def test_initial_source_is_persisted_once_and_save_is_lossless(self):
        result=self.client.get(f'/api/editor/{self.clip}'); self.assertEqual(result.status_code,200,result.text)
        self.assertIsNotNone(result.json()['saved_at'])
        self.assertTrue(result.json()['project']['source_seeded'])
        source=result.json()['project']['items'][0]
        self.assertAlmostEqual(source['duration'],3,places=1)
        with db.connect() as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM editor_projects').fetchone()[0],1)
        project=self.project(self.item(keyframes=[{'time':1,'x':20},{'time':0,'x':-20},{'time':1,'x':30}]))
        saved=self.client.put(f'/api/editor/{self.clip}',json=project.model_dump())
        self.assertEqual(saved.status_code,200,saved.text)
        self.assertEqual(saved.json()['project'],self.client.get(f'/api/editor/{self.clip}').json()['project'])
        self.assertEqual([f['x'] for f in saved.json()['project']['items'][0]['keyframes']],[-20,30])

    def test_saved_empty_source_seed_and_deliberate_clear(self):
        self.add_media(self.unknown,self.red,'source')
        self.client.put(f'/api/editor/{self.unknown}',json=Project().model_dump())
        seeded=self.client.get(f'/api/editor/{self.unknown}').json()
        self.assertEqual(len(seeded['project']['items']),1)
        self.assertTrue(seeded['project']['source_seeded'])
        self.assertEqual(db.get_clip(self.unknown)['license_status'],'unknown')
        # An old client omitting the marker can still deliberately clear all.
        self.client.put(f'/api/editor/{self.unknown}',json=Project().model_dump())
        self.assertEqual(self.client.get(f'/api/editor/{self.unknown}').json()['project']['items'],[])
        self.assertEqual(self.client.get(f'/api/editor/{self.unknown}').json()['saved_at'],
                         self.client.get(f'/api/editor/{self.unknown}').json()['saved_at'])

    def test_additive_document_contract_and_modern_caption_style(self):
        from .editor_models import TextStyle
        from .captions import CAPTION_DEFAULTS
        style=TextStyle.model_validate({**CAPTION_DEFAULTS,'emphasis':'pop','glow':20})
        item=TimelineItem(id='text',kind='text',track=512,duration=2,text='One two',
                          text_style=style,caption_words=[{'word':'One','start':.1,'end':.4},{'word':'two','start':1,'end':1.5}],
                          font_family='DejaVu Sans',animation_loop='pulse',keyframes=[{'time':0,'easing':'hold','values':{'scale':.5}}])
        project=Project(items=[item],tracks=[{'id':512,'name':'Captions','kind':'text','hidden':True}],
                        markers=[{'id':'m','time':1,'label':'beat'}],script='Narration',name='New')
        response=self.client.put(f'/api/editor/{self.clip}',json=project.model_dump())
        self.assertEqual(response.status_code,200,response.text)
        project.source_seeded=True
        self.assertEqual(response.json()['project'],project.model_dump())
        self.assertEqual(Project.model_validate({'items':[]}).tracks,[])
        self.assertEqual(len(Project(items=[item.model_copy(update={'id':str(n)}) for n in range(5000)]).items),5000)
        for bad in ({'caption_words':[{'word':'Oops','start':1,'end':3}]},
                    {'crop':{'left':80,'right':30}}, {'keyframes':[{'time':0,'values':{'scale':100}}]}):
            with self.assertRaises(ValueError):
                TimelineItem.model_validate({**item.model_dump(),**bad})

    def test_image_import_thumbnail_and_long_still_export(self):
        from PIL import Image
        for format,suffix in (('PNG','png'),('JPEG','jpg'),('WEBP','webp')):
            buffer=io.BytesIO(); Image.new('RGB',(80,60),(0,255,0)).save(buffer,format=format)
            imported=self.client.post(f'/api/editor/{self.clip}/media',data={'role':'image'},files={'file':(f'picture.{suffix}',buffer.getvalue(),f'image/{suffix}')})
            self.assertEqual(imported.status_code,200,imported.text)
            media=imported.json()
            self.assertEqual((media['media_type'],media['duration'],media['width'],media['height']),('image',5,80,60))
            self.assertFalse(media['has_audio'])
            preview=self.client.get(media['thumbnail_url'])
            self.assertEqual(preview.status_code,200,preview.text if preview.status_code!=200 else '')
            self.assertEqual(preview.headers['content-type'],'image/jpeg')
        still=self.item(asset_id=media['id'],duration=6,fit='cover',speed=10)
        output=self.render(self.project(still))
        self.assertAlmostEqual(probe_media(output)['duration'],6,delta=1/30)
        self.assertGreater(self.pixel(self.pixels(output,5.8),240,240)[1],200)
        bad=self.client.post(f'/api/editor/{self.clip}/media',data={'role':'image'},files={'file':('broken.png',b'\x89PNG\r\n\x1a\nnot an image','image/png')})
        self.assertEqual(bad.status_code,400)

    def test_webm_microphone_recording_import(self):
        recording=self.folder/'recording.webm'
        subprocess.run([self.ffmpeg,'-v','error','-y','-i',str(self.red),'-vn','-c:a','libopus',str(recording)],check=True)
        imported=self.client.post(f'/api/editor/{self.clip}/media',data={'role':'voiceover'},files={'file':('recording.webm',recording.read_bytes(),'audio/webm')})
        self.assertEqual(imported.status_code,200,imported.text)
        self.assertEqual(imported.json()['media_type'],'audio')
        self.assertGreater(max(imported.json()['waveform']),.03)

    def test_track_hidden_muted_freeze_reverse_and_effects(self):
        hidden=self.project(self.item(fit='cover',duration=.3))
        from .editor_models import EditorTrack
        hidden.tracks=[EditorTrack(id=0,hidden=True,muted=True)]
        output=self.render(hidden)
        self.assertLess(max(self.pixel(self.pixels(output,.1),240,240)),10)
        self.assertLess(self.rms(output,.1),.002)
        frozen=self.item(freeze_at=1,duration=4,fit='cover')
        output=self.render(self.project(frozen))
        self.assertGreater(self.pixel(self.pixels(output,3.8),240,240)[0],200)
        self.assertLess(self.rms(output,.1),.002)
        base=self.item(duration=.3,fit='cover',muted=True)
        for values in ({'adjustments':{'saturation':0,'brightness':.1,'contrast':1.2,'exposure':.2}},
                       {'adjustments':{'temperature':.3,'tint':.2,'highlights':.1,'shadows':.1,'sharpen':.4,'vignette':.1,'grain':.05,'blur':1}},
                       {'mask':{'shape':'circle','feather':5}},
                       {'chroma_key':{'enabled':True,'color':'#ff0000','similarity':.3}},
                       {'conceal':{'mode':'cover','x':0,'y':0,'width':50,'height':100,'color':'#0000ff'}},
                       {'conceal':{'mode':'blur','x':10,'y':10,'width':40,'height':30}},
                       {'conceal':{'mode':'mosaic','x':10,'y':10,'width':40,'height':30}},
                       {'flip_x':True,'flip_y':True,'crop':{'left':20,'top':10}},
                       {'reverse':True}):
            item=TimelineItem.model_validate({**base.model_dump(),**values})
            frame=self.pixels(self.render(self.project(item)),.1)
            if 'mask' in values: self.assertLess(max(self.pixel(frame,10,10)),20)
            if 'chroma_key' in values: self.assertLess(max(self.pixel(frame,240,240)),20)
            if 'conceal' in values and values['conceal']['mode']=='cover':
                self.assertGreater(self.pixel(frame,100,240)[2],200)

    def test_real_word_timing_and_font_ass(self):
        from .captions import caption_ass
        item=TimelineItem(id='caption',kind='text',duration=2,text='ONE TWO',font_size=180,
                          font_family='DejaVu Sans',text_style={'reveal':'karaoke','highlight':'#ffff00'},
                          caption_words=[{'word':'ONE','start':.3,'end':.5},{'word':'TWO','start':1.4,'end':1.7}])
        ass=caption_ass(item,480,480,480/1080)
        self.assertIn('0:00:01.40,0:00:01.70',ass)
        self.assertNotIn('\\k100',ass)
        output=self.render(self.project(item))
        def yellow(time):
            frame=self.pixels(output,time)
            return sum(r>150 and g>150 and b<100 for r,g,b in zip(frame[::3],frame[1::3],frame[2::3]))
        self.assertGreater(yellow(.4),100)
        self.assertLess(yellow(.9),10)
        self.assertGreater(yellow(1.5),100)

    def test_advanced_easing_and_loops_match_ffmpeg_evaluator(self):
        for easing in ('hold','spring','bounce','cubic-bezier'):
            item=self.item(duration=1,keyframes=[{'time':0,'x':0,'easing':easing,'bezier':[.25,.1,.25,1]}, {'time':1,'x':100}])
            expression=visual_expression(item,'x','t').replace(',',chr(92)+',')
            raw=subprocess.run([self.ffmpeg,'-v','error','-f','lavfi','-i',f"aevalsrc=exprs='{expression}':duration=1:sample_rate=1000",'-f','f32le','-ac','1','pipe:1'],capture_output=True,check=True).stdout
            samples=array.array('f'); samples.frombytes(raw)
            for step in (0,100,375,500,999):
                self.assertAlmostEqual(samples[step],interpolate(item,step/1000)['x'],delta=.01,msg=f'{easing} at {step}')
        for preset,field in (('pulse','scale'),('wobble','rotation'),('shake','x'),('float','y'),('spin-left','rotation'),('fade','opacity')):
            item=self.item(duration=1,animation_loop=preset)
            expression=visual_expression(item,field,'t').replace(',',chr(92)+',')
            raw=subprocess.run([self.ffmpeg,'-v','error','-f','lavfi','-i',f"aevalsrc=exprs='{expression}':duration=1:sample_rate=1000",'-f','f32le','-ac','1','pipe:1'],capture_output=True,check=True).stdout
            samples=array.array('f'); samples.frombytes(raw)
            self.assertAlmostEqual(samples[125],interpolate(item,.125)[field],delta=.01)

    def test_caption_styles_word_reveal_and_animation_survive_save_and_render(self):
        item = TimelineItem(id='caption',kind='text',duration=1.2,text='ONE TWO',font_size=180,
            color='#ffffff',text_style={'bold':True,'stroke':3,'reveal':'karaoke','highlight':'#ffff00'})
        project = self.project(item)
        saved = self.client.put(f'/api/editor/{self.clip}',json=project.model_dump())
        self.assertEqual(saved.status_code,200,saved.text)
        self.assertEqual(saved.json()['project']['items'][0]['text_style']['reveal'],'karaoke')
        output = self.render(project)
        def yellow_count(frame):
            return sum(1 for r,g,b in zip(frame[::3],frame[1::3],frame[2::3]) if r>150 and g>150 and b<100)
        self.assertGreater(yellow_count(self.pixels(output,.9)),yellow_count(self.pixels(output,.1))*1.4)
        item.text_style.reveal='typewriter'
        item.text_background='#202040'
        item.text_style.italic=True
        output=self.render(self.project(item))
        def lit_count(frame):
            return sum(1 for r,g,b in zip(frame[::3],frame[1::3],frame[2::3]) if r>150 and g>150 and b>150)
        self.assertGreater(lit_count(self.pixels(output,.9)),lit_count(self.pixels(output,.1))*1.4)
        for animation in ['pop','bounce','spin-left','spin-right']:
            item.animation_in=animation
            item.text_style.reveal='none'
            output=self.render(self.project(item))
            self.assertGreater(lit_count(self.pixels(output,.8)),100)

    def test_media_probe_real_waveform_and_audio_upload(self):
        media=editor_media(self.source)
        self.assertEqual((media['width'],media['height']),(160,90))
        self.assertTrue(media['has_audio']); self.assertEqual(len(media['waveform']),96)
        self.assertGreater(max(media['waveform']),.03)
        result=self.client.post(f'/api/editor/{self.clip}/media',data={'role':'voiceover'},files={'file':('recording.mp4',self.red.read_bytes(),'video/mp4')})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['media_type'],'audio'); self.assertEqual(result.json()['name'],'recording')
        self.assertTrue(result.json()['path'].endswith('.wav'))
        self.assertTrue(db.resolve_data_path(self.source['path']).exists())

    def test_video_import_normalizes_container_for_browser_playback(self):
        response=self.client.post(f'/api/editor/{self.clip}/media',data={'role':'video'},files={'file':('camera.mov',self.red.read_bytes(),'video/quicktime')})
        self.assertEqual(response.status_code,200,response.text)
        self.assertTrue(response.json()['path'].endswith('.mp4'))
        self.assertEqual(response.json()['name'],'camera')
        self.assertEqual(response.json()['media_type'],'video')
        self.assertTrue(db.resolve_data_path(self.source['path']).is_file())

    def test_rejects_bad_ranges_wrong_ownership_missing_media_and_unknown_export(self):
        for item in (self.item(duration=4),self.item(source_in=2,duration=1,speed=2)):
            response=self.client.put(f'/api/editor/{self.clip}',json=self.project(item).model_dump()); self.assertEqual(response.status_code,400,response.text)
        project=self.project(self.item())
        response=self.client.put(f'/api/editor/{self.other}',json=project.model_dump()); self.assertEqual(response.status_code,400)
        self.assertEqual(self.client.post(f'/api/editor/{self.unknown}/export',json={'project':project.model_dump(),'resolution':480}).status_code,400)
        db.resolve_data_path(self.source['path']).unlink()
        self.assertEqual(self.client.put(f'/api/editor/{self.clip}',json=project.model_dump()).status_code,404)

    def test_rejects_untrusted_values_and_cleans_project_media(self):
        project=self.project(self.item()).model_dump(); project['background']='red;movie=/etc/passwd'
        self.assertEqual(self.client.put(f'/api/editor/{self.clip}',json=project).status_code,422)
        project=self.project(self.item()).model_dump(); project['items'][0]['transform']['scale']=1000
        self.assertEqual(self.client.put(f'/api/editor/{self.clip}',json=project).status_code,422)
        for kind in ('music','audio','vocals','instrumental','voiceover'):
            self.add_media(self.clip,self.red,kind)
        self.client.put(f'/api/editor/{self.clip}',json=self.project(self.item()).model_dump())
        db.delete_clip(self.clip)
        with db.connect() as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM editor_projects').fetchone()[0],0)
        self.assertEqual(list(self.folder.glob('*.mp4')),[])

    def test_real_multitrack_export_timing_mute_and_audio_mix(self):
        red=self.item(duration=1,muted=True)
        blue=self.item(id='blue',asset_id=self.blue_asset['id'],start=1,source_in=.5,duration=1,speed=2,muted=True)
        audio=self.item(id='audio',kind='audio',start=.5,duration=1,volume=.5,fade_in=.2,fade_out=.2)
        output=self.render(self.project(red,blue,audio))
        redpx=self.pixel(self.pixels(output,.25),240,240)
        bluepx=self.pixel(self.pixels(output,1.25),240,240)
        self.assertGreater(redpx[0],200); self.assertLess(redpx[2],15)
        self.assertGreater(bluepx[2],200); self.assertLess(bluepx[0],15)
        self.assertLess(self.rms(output,.15),.001)
        self.assertGreater(self.rms(output,.8),.02)
        self.assertLess(self.rms(output,1.75),.001)
        self.assertLess(self.rms(output,.505,.03),self.rms(output,.8)*.5)
        self.assertAlmostEqual(probe_media(output)['duration'],2,delta=.05)

    def test_keyframed_affine_pixels_and_opacity_animate(self):
        item=self.item(duration=1,muted=True,keyframes=[{'time':0,'x':-25,'scale':.4,'opacity':.25,'rotation':0},{'time':1,'x':25,'scale':.4,'opacity':1,'rotation':90}])
        output=self.render(self.project(item))
        early=self.pixels(output,0); late=self.pixels(output,.9)
        self.assertGreater(self.pixel(early,120,240)[0],40)
        self.assertLess(self.pixel(early,350,240)[0],10)
        self.assertGreater(self.pixel(late,348,240)[0],200)
        self.assertLess(self.pixel(late,100,240)[0],10)
        # Rotation becomes vertical at the end, unlike the wide fitted source.
        self.assertGreater(self.pixel(late,348,315)[0],100)

    def test_animation_presets_text_layers_and_escaped_text(self):
        video=self.item(duration=1,muted=True,animation_in='fade',animation_duration=.5)
        text=TimelineItem(id='text',kind='text',track=2,start=.5,duration=.5,text='Hello world',font_size=120,color='#ffffff',text_background='#111111')
        output=self.render(self.project(video,text))
        beginning=self.pixel(self.pixels(output,0),240,200)
        middle=self.pixel(self.pixels(output,.4),240,200)
        self.assertLess(beginning[0],10); self.assertGreater(middle[0],150)
        frame=self.pixels(output,.75)
        self.assertGreater(sum(1 for i in range(0,len(frame),3) if min(frame[i:i+3])>180),100)
        escaped=TimelineItem(id='text2',kind='text',duration=.1,text='{\\pos(0,0)}user text')
        self.render(self.project(escaped))

    def test_keyframe_easing_and_animations_share_contract(self):
        item=self.item(duration=2,keyframes=[{'time':0,'x':0,'easing':'ease-in'},{'time':2,'x':100}])
        self.assertEqual(interpolate(item,1)['x'],25)
        item=self.item(duration=2,animation_in='slide-left',animation_out='zoom-out',animation_duration=1)
        self.assertEqual(interpolate(item,0)['x'],-100)
        self.assertAlmostEqual(interpolate(item,2)['scale'],1.35)

    def test_modern_presets_match_preview_and_change_rendered_pixels(self):
        # Every preset added to the Pydantic contract must also reach the FFmpeg
        # graph; a preset that only exists in the model renders as no motion.
        modern=['drop','float','drift','rise-fade','punch','blur-in','glitch','swing','tilt','push-in','whip','fade-zoom']
        self.assertEqual(set(modern),set(modern)&set(get_args(Animation)))
        # Preview parity: interpolate() is what the dashboard mirrors, so
        # evaluating the real filter expression must agree with it sample by
        # sample. Guards against a preset added to one side of the contract only.
        for preset in modern:
            item=self.item(duration=1,animation_in=preset,animation_duration=.5)
            for field in ('x','y','scale','rotation','opacity'):
                raw=subprocess.run([self.ffmpeg,'-v','error','-f','lavfi','-i',f"aevalsrc=exprs='{visual_expression(item,field,'t').replace(',',chr(92)+',')}':duration=1:sample_rate=1000",'-f','f32le','-ac','1','pipe:1'],capture_output=True,check=True).stdout
                samples=array.array('f'); samples.frombytes(raw)
                for step in (0,50,125,250,375,499):
                    expected=interpolate(item,step/1000)[field]
                    self.assertAlmostEqual(samples[step],expected,delta=.01,msg=f'{preset} {field} @ {step}ms')
        # ...and the motion has to be visible in real rendered pixels, not just
        # in the numbers. Contain keeps the fitted video band on black so scale
        # and rotation changes are measurable.
        rest=self.pixels(self.render(self.project(self.item(duration=1,muted=True,fit='contain'))),.9)
        def moved(frame,reference):
            return sum(1 for a,b in zip(frame,reference) if abs(a-b)>12)/len(frame)
        for preset in modern:
            item=self.item(duration=1,muted=True,fit='contain',animation_in=preset,animation_duration=.5)
            settled=self.pixels(self.render(self.project(item)),.9)
            self.assertLess(moved(settled,rest),.02,f'{preset} never settled to rest')
            early=self.pixels(self.render(self.project(item)),.02)
            self.assertGreater(moved(early,settled),.02,f'{preset} did not move any rendered pixel')
        for preset in ('drop','punch','glitch'):
            item=self.item(duration=1,muted=True,fit='contain',animation_in=preset,animation_duration=.5)
            self.assertGreater(moved(self.pixels(self.render(self.project(item)),.02),rest),.02,f'{preset} did not change pixels')

    def test_source_trim_speed_and_layer_stacking_are_visible(self):
        switching=self.folder/'switch.mp4'
        subprocess.run([self.ffmpeg,'-v','error','-y','-f','lavfi','-i','color=red:s=160x90:r=30:d=1.5','-f','lavfi','-i','color=blue:s=160x90:r=30:d=1.5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-pix_fmt','yuv420p',str(switching)],check=True)
        asset=db.add_asset(self.clip,'video',switching)
        output=self.render(self.project(self.item(asset_id=asset['id'],source_in=1.25,duration=.5,speed=2,muted=True)))
        self.assertGreater(self.pixel(self.pixels(output,.05),240,240)[0],200)
        self.assertGreater(self.pixel(self.pixels(output,.3),240,240)[2],200)
        base=self.item(duration=.2,muted=True,fit='cover')
        overlay=self.item(id='overlay',asset_id=self.blue_asset['id'],duration=.2,track=2,muted=True,transform={'scale':.5,'opacity':.5})
        output=self.render(self.project(overlay,base))
        frame=self.pixels(output,.1)
        mixed=self.pixel(frame,240,240); outside=self.pixel(frame,40,240)
        self.assertTrue(90<mixed[0]<160 and 90<mixed[2]<160,mixed)
        self.assertGreater(outside[0],200); self.assertLess(outside[2],15)

    def test_long_motion_path_renders_without_expression_recursion_failure(self):
        item=self.item(duration=.2,muted=True,keyframes=[{'time':i*.2/119,'x':i/3,'scale':.4} for i in range(120)])
        output=self.render(self.project(item))
        self.assertGreater(self.pixel(self.pixels(output,0),240,240)[0],200)

    def test_volume_keyframes_change_rendered_audio(self):
        audio=self.item(kind='audio',duration=1,keyframes=[{'time':0,'volume':0},{'time':1,'volume':1}])
        output=self.render(self.project(audio))
        self.assertGreater(self.rms(output,.8,.05),self.rms(output,.15,.05)*3)

    def test_unknown_rights_preserved_without_blocking_local_media(self):
        assets=[self.add_media(self.clip,self.red,kind) for kind in ('video','audio','voiceover','music','vocals','instrumental')]
        with db.connect() as connection:
            connection.execute("UPDATE clips SET license_status='unknown' WHERE id=?",(self.clip,))
        for asset in assets:
            self.assertEqual(self.client.get(asset['url']).status_code,200)

    def test_disguised_playlist_upload_is_rejected_before_probe(self):
        result=self.client.post(f'/api/editor/{self.clip}/media',data={'role':'video'},files={'file':('movie.mp4',b'#EXTM3U\nhttps://example.com/private.ts','video/mp4')})
        self.assertEqual(result.status_code,400,result.text)

    def test_export_job_snapshot_does_not_implicitly_save(self):
        project=self.project(self.item(duration=.2,muted=True))
        response=self.client.post(f'/api/editor/{self.clip}/export',json={'project':project.model_dump(),'resolution':480})
        self.assertEqual(response.status_code,200,response.text)
        job=db.get_job(response.json()['id'])
        self.assertEqual(job['status'],'completed',job)
        self.assertEqual(job['result']['width'],480)
        self.assertEqual(db.get_clip(self.clip)['workflow_status'],'exported')
        with db.connect() as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM editor_projects').fetchone()[0],0)

if __name__=='__main__': unittest.main()
