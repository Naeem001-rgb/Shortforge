"""CPU FFmpeg renderer for the same timeline interpolation used by preview.

Every filter expression is built from validated numbers/enums. Text is escaped
into generated ASS files and paths passed as process arguments, never a shell.
"""
from pathlib import Path
import math
import re
import subprocess
import tempfile

from .editor_models import Project, TimelineItem
from .media import ffmpeg_binary


def number(value):
    return format(float(value), '.10g')


def ease_out(progress, power=5):
    """Quint/expo-style ease-out shared by the preview and the FFmpeg graph.

    1-pow(1-p,5) spends most of the duration near the resting state, which is
    what reads as "modern" next to the linear slides of the original presets.
    """
    return 1-(1-progress)**power


def interpolate(item, time):
    """Reference evaluator used in regression tests and export diagnostics."""
    values = {**item.transform.model_dump(), 'volume':item.volume}
    frames = item.keyframes
    if frames:
        left, right = frames[0], frames[-1]
        if time <= left.time: values = left.model_dump()
        elif time >= right.time: values = right.model_dump()
        else:
            for a,b in zip(frames,frames[1:]):
                if a.time <= time < b.time:
                    q=(time-a.time)/(b.time-a.time)
                    if a.easing == 'ease-in': q=q*q
                    elif a.easing == 'ease-out': q=1-(1-q)**2
                    elif a.easing == 'ease-in-out': q=q*q*(3-2*q)
                    values = {k:getattr(a,k)+(getattr(b,k)-getattr(a,k))*q for k in ('x','y','scale','rotation','opacity','volume')}
                    break
    for preset,p in ((item.animation_in,time/item.animation_duration),(item.animation_out,(item.duration-time)/item.animation_duration)):
        p=max(0,min(1,p))
        if preset == 'fade': values['opacity'] *= p
        if preset == 'slide-left': values['x'] -= 100*(1-p)
        if preset == 'slide-right': values['x'] += 100*(1-p)
        if preset == 'slide-up': values['y'] -= 100*(1-p)
        if preset == 'slide-down': values['y'] += 100*(1-p)
        if preset == 'zoom-in': values['scale'] *= .65+.35*p
        if preset == 'zoom-out': values['scale'] *= 1.35-.35*p
        if preset == 'pop': values['scale'] *= .7+.3*p+.16*math.sin(math.pi*p)
        if preset == 'bounce': values['y'] += 20*(1-p)*math.cos(3*math.pi*p)
        if preset == 'spin-left': values['rotation'] -= 180*(1-p)
        if preset == 'spin-right': values['rotation'] += 180*(1-p)
        # Modern presets below share the quint ease-out above so entrances
        # settle instead of sliding linearly. They only touch x/y/scale/
        # rotation/opacity, the same fields the FFmpeg graph can animate.
        e=ease_out(p)
        if preset == 'drop': values['y'] -= 100*(1-e)
        if preset == 'float':
            values['y'] += 50*(1-e)
            values['opacity'] *= e
        if preset == 'drift':
            values['x'] += 50*(1-e)
            values['y'] -= 40*(1-e)
        if preset == 'rise-fade':
            values['y'] -= 40*(1-e)
            values['opacity'] *= e
        # Overshoot past 1 near the end of the ease, then back to rest.
        if preset == 'punch': values['scale'] *= .5+.5*e+.35*math.sin(math.pi*e**.7)
        # No blur filter exists in this graph, so this fakes a depth-of-field
        # pull: slightly oversized and transparent, settling sharp and opaque.
        if preset == 'blur-in':
            values['scale'] *= 1.15-.15*e
            values['opacity'] *= e
        # Deterministic jitter: damped sine on rotation and x, no randomness.
        if preset == 'glitch':
            values['rotation'] += 8*(1-e)*math.sin(12*math.pi*p)
            values['x'] += 6*(1-e)*math.sin(9*math.pi*p)
        if preset == 'swing': values['rotation'] += 16*(1-e)*math.sin(2.4*math.pi*p)
        if preset == 'tilt':
            values['rotation'] -= 18*(1-e)
            values['x'] -= 12*(1-e)
        if preset == 'push-in': values['scale'] *= 1.4-.4*e
        if preset == 'whip':
            values['x'] += 120*(1-e)
            values['rotation'] -= 8*(1-e)
        if preset == 'fade-zoom':
            values['opacity'] *= e
            values['scale'] *= .85+.15*e
    return values


def frame_expression(item, field, time):
    frames = item.keyframes
    base = item.volume if field == 'volume' else getattr(item.transform, field)
    if not frames:
        return number(base)
    if len({getattr(frame, field) for frame in frames}) == 1:
        return number(getattr(frames[0], field))
    segments = []
    for left, right in zip(frames, frames[1:]):
        q = f'clip(({time}-{number(left.time)})/{number(right.time-left.time)},0,1)'
        if left.easing == 'ease-in':
            q = f'pow({q},2)'
        elif left.easing == 'ease-out':
            q = f'(1-pow(1-{q},2))'
        elif left.easing == 'ease-in-out':
            q = f'(pow({q},2)*(3-2*{q}))'
        segments.append(f'({number(getattr(left,field))}+{number(getattr(right,field)-getattr(left,field))}*{q})')
    segments.append(number(getattr(frames[-1], field)))

    def branch(start, end):
        # Balanced conditionals avoid FFmpeg expression parser recursion limits
        # when a motion path contains many keyframes (up to 120 supported).
        if end-start == 1:
            return segments[start]
        middle = (start+end)//2
        return f'if(lt({time},{number(frames[middle].time)}),{branch(start,middle)},{branch(middle,end)})'

    return branch(0, len(segments))


def visual_expression(item, field, time):
    expr=frame_expression(item,field,time)
    for preset,progress in ((item.animation_in,f'clip({time}/{number(item.animation_duration)},0,1)'),(item.animation_out,f'clip(({number(item.duration)}-{time})/{number(item.animation_duration)},0,1)')):
        # Quint ease-out 1-pow(1-p,5), mirroring ease_out() used by interpolate().
        ease=f'(1-pow(1-{progress},5))'
        if preset=='fade' and field=='opacity': expr=f'({expr}*{progress})'
        elif field=='x' and preset in {'slide-left','slide-right'}:
            expr=f'({expr}{"-" if preset=="slide-left" else "+"}100*(1-{progress}))'
        elif field=='y' and preset in {'slide-up','slide-down'}:
            expr=f'({expr}{"-" if preset=="slide-up" else "+"}100*(1-{progress}))'
        elif field=='scale' and preset=='zoom-in': expr=f'({expr}*(0.65+0.35*{progress}))'
        elif field=='scale' and preset=='zoom-out': expr=f'({expr}*(1.35-0.35*{progress}))'
        elif field=='scale' and preset=='pop': expr=f'({expr}*(0.7+0.3*{progress}+0.16*sin(PI*{progress})))'
        elif field=='y' and preset=='bounce': expr=f'({expr}+20*(1-{progress})*cos(3*PI*{progress}))'
        elif field=='rotation' and preset in {'spin-left','spin-right'}:
            expr=f'({expr}{"-" if preset=="spin-left" else "+"}180*(1-{progress}))'
        elif field=='y' and preset=='drop': expr=f'({expr}-100*(1-{ease}))'
        elif field=='y' and preset=='float': expr=f'({expr}+50*(1-{ease}))'
        elif field=='x' and preset=='drift': expr=f'({expr}+50*(1-{ease}))'
        elif field=='y' and preset=='drift': expr=f'({expr}-40*(1-{ease}))'
        elif field=='y' and preset=='rise-fade': expr=f'({expr}-40*(1-{ease}))'
        elif field=='opacity' and preset in {'float','rise-fade','blur-in','fade-zoom'}: expr=f'({expr}*{ease})'
        elif field=='scale' and preset=='punch':
            expr=f'({expr}*(0.5+0.5*{ease}+0.35*sin(PI*pow({ease},0.7))))'
        # No blur filter exists in this graph, so this fakes a depth-of-field pull.
        elif field=='scale' and preset=='blur-in': expr=f'({expr}*(1.15-0.15*{ease}))'
        # Deterministic jitter, no randomness, so preview and export agree.
        elif field=='rotation' and preset=='glitch': expr=f'({expr}+8*(1-{ease})*sin(12*PI*{progress}))'
        elif field=='x' and preset=='glitch': expr=f'({expr}+6*(1-{ease})*sin(9*PI*{progress}))'
        elif field=='rotation' and preset=='swing': expr=f'({expr}+16*(1-{ease})*sin(2.4*PI*{progress}))'
        elif field=='rotation' and preset=='tilt': expr=f'({expr}-18*(1-{ease}))'
        elif field=='x' and preset=='tilt': expr=f'({expr}-12*(1-{ease}))'
        elif field=='scale' and preset=='push-in': expr=f'({expr}*(1.4-0.4*{ease}))'
        elif field=='x' and preset=='whip': expr=f'({expr}+120*(1-{ease}))'
        elif field=='rotation' and preset=='whip': expr=f'({expr}-8*(1-{ease}))'
        elif field=='scale' and preset=='fade-zoom': expr=f'({expr}*(0.85+0.15*{ease}))'
    return expr


def ass_color(hex_color):
    return '&H00'+hex_color[5:7]+hex_color[3:5]+hex_color[1:3]


def write_text(item, width, height, directory, index, ratio):
    from .captions import ass_time
    style = item.text_style
    content = item.text.upper() if style.uppercase else item.text
    def escaped(value):
        return value.replace('\\','＼').replace('{','｛').replace('}','｝').replace('\r','').replace('\n','\\N')
    words = re.findall(r'\S+\s*', content)
    font_size=item.font_size*ratio
    margin=round(width*.05)
    primary = ass_color(style.highlight if style.reveal == 'karaoke' else item.color)
    alignment = {'left':4, 'center':5, 'right':6}[style.align]
    bold, italic = (-1 if style.bold else 0), (-1 if style.italic else 0)
    common = f'{bold},{italic},0,0,100,100,{style.letter_spacing*ratio},0'
    tail = f'{alignment},{margin},{margin},0,1'
    styles = f'Style: Default,DejaVu Sans,{font_size},{primary},{ass_color(item.color)},{ass_color(style.stroke_color)},&H80000000,{common},1,{style.stroke*ratio},{style.shadow*ratio},{tail}\n'
    if item.text_background != 'transparent':
        background = ass_color(item.text_background)
        styles += f'Style: Box,DejaVu Sans,{font_size},{ass_color(item.color)},{ass_color(item.color)},{background},{background},{common},3,{max(2,font_size*.14)},0,{tail}\n'
    events = []
    def event(start, end, value, box_value):
        if item.text_background != 'transparent':
            events.append(f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Box,,0,0,0,,{box_value}')
        events.append(f'Dialogue: 1,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{value}')
    if style.reveal == 'typewriter' and words:
        for n in range(len(words)):
            value = escaped(''.join(words[:n+1]).rstrip())
            event(n*item.duration/len(words), (n+1)*item.duration/len(words), value, value)
    else:
        value = escaped(content)
        if style.reveal == 'karaoke' and words:
            value = ''.join('{\\k'+str(max(1,round((n+1)*item.duration*100/len(words))-round(n*item.duration*100/len(words))))+'}'+escaped(word) for n,word in enumerate(words))
        event(0,item.duration,value,escaped(content))
    ass=f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{styles}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
{chr(10).join(events)}
'''
    name=f'text-{index}.ass'
    (directory/name).write_text(ass,encoding='utf-8')
    return name


def output_size(project, resolution):
    ratio=resolution/min(project.width,project.height)
    # yuv420 requires even dimensions. Match ratio as closely as possible.
    width=round(project.width*ratio/2)*2
    height=round(project.height*ratio/2)*2
    return width,height,ratio


def build_render_command(project: Project, assets: dict, output: Path, resolution: int, directory: Path):
    width,height,ratio=output_size(project,resolution)
    fps=project.fps; duration=project.duration
    command=[ffmpeg_binary(),'-hide_banner','-y','-nostdin']
    inputs={}
    for index,item in enumerate(project.items):
        if item.kind!='text':
            inputs[index]=len(inputs)
            path=assets[item.asset_id][1]
            command += ['-ss',number(item.source_in),'-t',number(item.duration*item.speed),'-protocol_whitelist','file,pipe','-i',str(path)]
    filters=[f'color=c={project.background}:s={width}x{height}:r={fps}:d={number(duration)},format=yuv420p[base]']
    visual='base'
    for index,item in sorted(enumerate(project.items),key=lambda pair:(pair[1].track,pair[0])):
        if item.kind=='audio': continue
        if item.kind=='video':
            fit='decrease' if item.fit=='contain' else 'increase'
            fitting=f'scale={width}:{height}:force_original_aspect_ratio={fit}:force_divisible_by=2'
            fitting += f',pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0' if item.fit=='contain' else f',crop={width}:{height}'
            head=f'[{inputs[index]}:v]setpts=(PTS-STARTPTS)/{number(item.speed)},fps={fps},trim=duration={number(item.duration)},format=yuva444p,{fitting},setsar=1'
        else:
            ass=write_text(item,width,height,directory,index,ratio)
            # ASS font copied under a generated safe name for all platforms.
            fontdir=Path(__file__).parent/'fonts'
            import shutil
            (directory/'fonts').mkdir(exist_ok=True)
            shutil.copyfile(fontdir/'DejaVuSans.ttf',directory/'fonts'/'DejaVuSans.ttf')
            head=f'color=c=black@0:s={width}x{height}:r={fps}:d={number(item.duration)},format=yuva444p,ass={ass}:fontsdir=fonts:alpha=1'
        transformed = bool(item.keyframes) or any(getattr(item.transform,key)!=value for key,value in {'x':0,'y':0,'scale':1,'rotation':0}.items()) or item.animation_in not in {'none','fade'} or item.animation_out not in {'none','fade'}
        if transformed:
            # Perspective applies an affine matrix per frame without dynamic
            # buffer sizes. Transparent 2px guards prevent edge extrapolation.
            time=f'(on/{fps})'
            x=visual_expression(item,'x',time); y=visual_expression(item,'y',time)
            scale=visual_expression(item,'scale',time)
            angle=f'({visual_expression(item,"rotation",time)}*PI/180)'
            entries=[]
            for corner,(cx,cy) in enumerate((('-W/2','-H/2'),('W/2','-H/2'),('-W/2','H/2'),('W/2','H/2'))):
                xx=f'W/2+(W-4)*({x})/100+({scale})*(({cx})*cos({angle})-({cy})*sin({angle}))'
                yy=f'H/2+(H-4)*({y})/100+({scale})*(({cx})*sin({angle})+({cy})*cos({angle}))'
                entries.extend([f"x{corner}='{xx}'",f"y{corner}='{yy}'"])
            head+=f',pad={width+4}:{height+4}:2:2:color=black@0,perspective='+':'.join(entries)+f':sense=destination:eval=frame:interpolation=cubic,crop={width}:{height}:2:2'
        opacity=visual_expression(item,'opacity','T')
        if opacity!='1': head+=f",geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*({opacity})'"
        head+=f',setpts=PTS+{number(item.start)}/TB[layer{index}]'
        filters.append(head)
        new=f'v{index}'
        filters.append(f"[{visual}][layer{index}]overlay=0:0:format=auto:eof_action=pass:repeatlast=0:enable='gte(t,{number(item.start)})*lt(t,{number(item.start+item.duration)})'[{new}]")
        visual=new
    filters.append(f'[{visual}]format=yuv420p[video]')
    audio_labels=[]
    for index,item in enumerate(project.items):
        if item.kind=='text' or item.muted or not assets[item.asset_id][2]['has_audio']: continue
        speed=item.speed; tempos=[]
        while speed<.5: tempos.append('atempo=0.5'); speed/=.5
        while speed>2: tempos.append('atempo=2'); speed/=2
        tempos.append(f'atempo={number(speed)}')
        volume=frame_expression(item,'volume','t')
        if item.fade_in: volume=f'({volume})*clip(t/{number(item.fade_in)},0,1)'
        if item.fade_out: volume=f'({volume})*clip(({number(item.duration)}-t)/{number(item.fade_out)},0,1)'
        label=f'a{index}'
        filters.append(f"[{inputs[index]}:a]asetpts=PTS-STARTPTS,{','.join(tempos)},aresample=48000,atrim=duration={number(item.duration)},volume='{volume}':eval=frame,adelay={round(item.start*48000)}S:all=1[{label}]")
        audio_labels.append(label)
    filters.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={number(duration)}[silence]')
    audio_labels.append('silence')
    filters.append(''.join(f'[{label}]' for label in audio_labels)+f'amix=inputs={len(audio_labels)}:duration=longest:normalize=0,alimiter=limit=0.95:level=false:latency=true,atrim=duration={number(duration)}[audio]')
    graph=directory/'filters.txt'; graph.write_text(';\n'.join(filters))
    command += ['-filter_complex_threads','2','-filter_complex_script',str(graph),'-map','[video]','-map','[audio]','-t',number(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r',str(fps),'-threads','2','-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1','-nostats',str(output)]
    return command


def render_project(project, assets, output, resolution, progress=None):
    if project.duration<=0: raise ValueError('Add at least one item before exporting.')
    with tempfile.TemporaryDirectory(prefix='shortforge-render-') as folder:
        directory=Path(folder)
        command=build_render_command(project,assets,output,resolution,directory)
        with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as errors:
            process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=errors,text=True,cwd=directory)
            try:
                for line in process.stdout:
                    if progress and line.startswith('out_time_us='):
                        try: progress(min(98,5+float(line.split('=',1)[1])/1_000_000/project.duration*93))
                        except ValueError: pass
                if process.wait()!=0:
                    errors.seek(0); log=errors.read()
                    # Only media/tool diagnostics; strip paths from user message.
                    raise ValueError('The timeline could not be rendered. Check that the source files still play and retry. '+log[-800:].replace(str(directory),'[render]').replace(str(output),'[output]'))
            finally:
                process.stdout.close()
                if process.poll() is None: process.kill(); process.wait()
    width,height,_=output_size(project,resolution)
    return {'duration':project.duration,'width':width,'height':height}
