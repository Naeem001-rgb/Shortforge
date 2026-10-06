"""CPU FFmpeg renderer for the same timeline interpolation used by preview.

Every filter expression is built from validated numbers/enums. Text is escaped
into generated ASS files and paths passed as process arguments, never a shell.
"""
from pathlib import Path
import math
import subprocess
import tempfile

from .editor_models import Project
from .editor_transitions import transition_alpha_expression, transition_map
from .media import ffmpeg_binary

#: Transitions whose FFmpeg build cannot ramp a blur radius over time — `gblur`,
#: `boxblur` and `unsharp` all reject time expressions for it. They are rendered
#: as a STATIC blur gated to the blend window by `enable=` instead, which is
#: visually correct at the seam and far cheaper than a per-frame blur.
STATIC_BLUR: frozenset[str] = frozenset({'blur', 'zoom-blur', 'whip-pan'})


def compatibility_issues(project):
    """Document unsupported treatment instead of silently dropping its intent."""
    issues=[]
    for item in project.items:
        missing=[]
        if item.blend_mode!='normal': missing.append('blend mode '+item.blend_mode)
        if item.kind=='text' and item.text_style.chip!='none': missing.append('individual word chips')
        if item.kind=='text' and item.text_style.line_height!=1: missing.append('custom caption line height')
        if item.animation_loop not in {'none','pulse','zoom-in','wobble','swing','shake','glitch','float','bounce','spin-right','spin-left','fade'}:
            missing.append('loop '+item.animation_loop)
        unsupported={name for frame in item.keyframes for name in frame.values
                     if name.startswith('crop.') or name.split('.')[-1] not in {'x','y','scale','rotation','opacity','volume','brightness','contrast','saturation','exposure'}}
        if unsupported: missing.append('animated '+', '.join(sorted(unsupported)))
        if missing: issues.append({'item_id':item.id,'name':item.name or item.kind,'features':missing})
    return issues


def number(value):
    return format(float(value), '.10g')


def ease_out(progress, power=5):
    """Quint/expo-style ease-out shared by the preview and the FFmpeg graph.

    1-pow(1-p,5) spends most of the duration near the resting state, which is
    what reads as "modern" next to the linear slides of the original presets.
    """
    return 1-(1-progress)**power


def ease_progress(progress, easing, bezier=None):
    """Mirror editorModel.easeProgress, including inversion of Bezier time."""
    p=max(0,min(1,progress))
    if easing=='hold': return 0 if p<1 else 1
    if easing=='ease-in': return p*p
    if easing=='ease-out': return 1-(1-p)**2
    if easing=='ease-in-out': return p*p*(3-2*p)
    if easing=='spring': return 1 if p==1 else 1-math.cos(p*math.pi*4.5)*math.exp(-6*p)
    if easing=='bounce':
        n,d=7.5625,2.75
        if p<1/d: return n*p*p
        if p<2/d: return n*(p-1.5/d)**2+.75
        if p<2.5/d: return n*(p-2.25/d)**2+.9375
        return n*(p-2.625/d)**2+.984375
    if easing=='cubic-bezier':
        x1,y1,x2,y2=bezier or (.25,.1,.25,1)
        def cubic(t,a,b): return 3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3
        lo,hi=0,1
        for _ in range(18):
            mid=(lo+hi)/2
            if cubic(mid,x1,x2)<p: lo=mid
            else: hi=mid
        return cubic((lo+hi)/2,y1,y2)
    return p


def ease_expression(q, easing, bezier=None):
    if easing=='hold': return f'gte({q},1)'
    if easing=='ease-in': return f'pow({q},2)'
    if easing=='ease-out': return f'(1-pow(1-{q},2))'
    if easing=='ease-in-out': return f'(pow({q},2)*(3-2*{q}))'
    if easing=='spring': return f'if(gte({q},1),1,1-cos(({q})*PI*4.5)*exp(-6*({q})))'
    if easing=='bounce':
        return f'if(lt({q},1/2.75),7.5625*pow({q},2),if(lt({q},2/2.75),7.5625*pow(({q})-1.5/2.75,2)+.75,if(lt({q},2.5/2.75),7.5625*pow(({q})-2.25/2.75,2)+.9375,7.5625*pow(({q})-2.625/2.75,2)+.984375)))'
    if easing=='cubic-bezier':
        # AVExpr supports local registers and while. Bisection gives the same
        # 18-iteration inversion as the browser without an enormous expression.
        x1,y1,x2,y2=bezier or (.25,.1,.25,1)
        t='((ld(1)+ld(2))/2)'
        x=f'(3*pow(1-{t},2)*{t}*{number(x1)}+3*(1-{t})*pow({t},2)*{number(x2)}+pow({t},3))'
        y=f'(3*pow(1-{t},2)*{t}*{number(y1)}+3*(1-{t})*pow({t},2)*{number(y2)}+pow({t},3))'
        return f'(st(0,{q});st(1,0);st(2,1);st(3,0);while(lt(ld(3),18),if(lt({x},ld(0)),st(1,{t}),st(2,{t}));st(3,ld(3)+1));{y})'
    return q


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
                    q=ease_progress(q,a.easing,a.bezier)
                    values = {k:getattr(a,k)+(getattr(b,k)-getattr(a,k))*q for k in ('x','y','scale','rotation','opacity','volume')}
                    break
    if frames:
        if time<=frames[0].time: values.update({name.split('.')[-1]:value for name,value in frames[0].values.items()})
        elif time>=frames[-1].time: values.update({name.split('.')[-1]:value for name,value in frames[-1].values.items()})
        else:
            for a,b in zip(frames,frames[1:]):
                if a.time<=time<b.time:
                    q=ease_progress((time-a.time)/(b.time-a.time),a.easing,a.bezier)
                    for name in a.values.keys()|b.values.keys():
                        field=name.split('.')[-1]
                        base=getattr(a,field,getattr(item.adjustments,field,0))
                        first=a.values.get(name,base); last=b.values.get(name,getattr(b,field,getattr(item.adjustments,field,0)))
                        values[field]=first+(last-first)*q
                    break
    for preset,p in ((item.animation_in,time/item.animation_duration),(item.animation_out,(item.duration-time)/item.animation_duration)):
        p=max(0,min(1,p))
        if preset=='pulse': values['scale'] *= 1+.1*math.sin(p*math.pi*4)*(1-p)
        if preset=='wobble': values['rotation'] += 12*math.sin(p*math.pi*4)*(1-p)
        if preset=='shake': values['x'] += 5*math.sin(p*math.pi*10)*(1-p)
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
    phase=time/max(.1,item.animation_duration)*math.pi*2
    preset=item.animation_loop
    if preset in {'pulse','zoom-in'}: values['scale']*=1+.06*math.sin(phase)
    elif preset in {'wobble','swing'}: values['rotation']+=6*math.sin(phase)
    elif preset in {'shake','glitch'}: values['x']+=1.4*math.sin(phase*3)
    elif preset in {'float','bounce'}: values['y']+=2*math.sin(phase)
    elif preset=='spin-right': values['rotation']+=time/max(.1,item.animation_duration)*360
    elif preset=='spin-left': values['rotation']-=time/max(.1,item.animation_duration)*360
    elif preset=='fade': values['opacity']*=.7+.3*math.sin(phase)
    return values


def frame_expression(item, field, time):
    frames = item.keyframes
    base = item.volume if field == 'volume' else getattr(item.transform, field, getattr(item.adjustments,field,0))
    def value(frame):
        return frame.values.get(field,frame.values.get('adjustments.'+field,frame.values.get('transform.'+field,getattr(frame,field,base))))
    if not frames:
        return number(base)
    if len({value(frame) for frame in frames}) == 1:
        return number(value(frames[0]))
    segments = []
    for left, right in zip(frames, frames[1:]):
        q = f'clip(({time}-{number(left.time)})/{number(right.time-left.time)},0,1)'
        q=ease_expression(q,left.easing,left.bezier)
        segments.append(f'({number(value(left))}+{number(value(right)-value(left))}*{q})')
    segments.append(number(value(frames[-1])))

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
        if preset=='pulse' and field=='scale': expr=f'({expr}*(1+.1*sin(({progress})*PI*4)*(1-{progress})))'
        elif preset=='wobble' and field=='rotation': expr=f'({expr}+12*sin(({progress})*PI*4)*(1-{progress}))'
        elif preset=='shake' and field=='x': expr=f'({expr}+5*sin(({progress})*PI*10)*(1-{progress}))'
        elif preset=='fade' and field=='opacity': expr=f'({expr}*{progress})'
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
    phase=f'({time}/{number(max(.1,item.animation_duration))}*PI*2)'
    preset=item.animation_loop
    if preset in {'pulse','zoom-in'} and field=='scale': expr=f'({expr}*(1+.06*sin({phase})))'
    elif preset in {'wobble','swing'} and field=='rotation': expr=f'({expr}+6*sin({phase}))'
    elif preset in {'shake','glitch'} and field=='x': expr=f'({expr}+1.4*sin({phase}*3))'
    elif preset in {'float','bounce'} and field=='y': expr=f'({expr}+2*sin({phase}))'
    elif preset in {'spin-right','spin-left'} and field=='rotation': expr=f'({expr}{"+" if preset=="spin-right" else "-"}{time}/{number(max(.1,item.animation_duration))}*360)'
    elif preset=='fade' and field=='opacity': expr=f'({expr}*(.7+.3*sin({phase})))'
    return expr


def ass_color(hex_color):
    return '&H00'+hex_color[5:7]+hex_color[3:5]+hex_color[1:3]


def write_text(item, width, height, directory, index, ratio):
    """Write one text item's ASS subtitle file and return its name.

    The document itself is built by `captions.caption_ass`, which is the same
    builder the dashboard's caption preview mirrors. Keeping one builder is what
    stops the exported MP4 from silently differing from what the user saw.
    """
    from .captions import caption_ass
    name = f'text-{index}.ass'
    (directory / name).write_text(
        caption_ass(item, width, height, ratio), encoding='utf-8')
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
            metadata=assets[item.asset_id][2]
            if metadata.get('media_type','video')=='image':
                command += ['-loop','1','-framerate',str(fps),'-t',number(item.duration),'-i',str(path)]
            elif item.freeze_at is not None:
                command += ['-ss',number(item.freeze_at),'-protocol_whitelist','file,pipe','-i',str(path)]
            else:
                command += ['-ss',number(item.source_in),'-t',number(item.duration*item.speed),'-protocol_whitelist','file,pipe','-i',str(path)]
    filters=[f'color=c={project.background}:s={width}x{height}:r={fps}:d={number(duration)},format=yuv420p[base]']
    visual='base'
    # Resolved once, before the loop: both halves of a blend must agree on the
    # window they share, and the pairing is O(n^2) so it stays out of the hot path.
    blends=transition_map(project.items)
    tracks={track.id:track for track in project.tracks}
    for index,item in sorted(enumerate(project.items),key=lambda pair:(pair[1].track,pair[0])):
        if item.kind=='audio' or (tracks.get(item.track) and tracks[item.track].hidden): continue
        if item.kind=='video':
            fit='decrease' if item.fit=='contain' else 'increase'
            fitting=f'scale={width}:{height}:force_original_aspect_ratio={fit}:force_divisible_by=2'
            fitting += f',pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0' if item.fit=='contain' else f',crop={width}:{height}'
            speed=1 if assets[item.asset_id][2].get('media_type','video')=='image' or item.freeze_at is not None else item.speed
            temporal='reverse,' if item.reverse and item.freeze_at is None else ''
            if item.freeze_at is not None:
                temporal+=f'trim=end_frame=1,loop=loop=-1:size=1:start=0,setpts=N/({fps}*TB),'
            head=f'[{inputs[index]}:v]{temporal}setpts=(PTS-STARTPTS)/{number(speed)},fps={fps},trim=duration={number(item.duration)},format=yuva444p'
            crop=item.crop
            if any(crop.model_dump().values()):
                head+=f',crop=iw*{number(1-(crop.left+crop.right)/100)}:ih*{number(1-(crop.top+crop.bottom)/100)}:iw*{number(crop.left/100)}:ih*{number(crop.top/100)}'
            if item.flip_x: head+=',hflip'
            if item.flip_y: head+=',vflip'
            if item.chroma_key.enabled:
                head+=f',chromakey={item.chroma_key.color}:{number(max(.01,item.chroma_key.similarity))}:.05'
            head+=f',{fitting},setsar=1'
        else:
            ass=write_text(item,width,height,directory,index,ratio)
            # ASS font copied under a generated safe name for all platforms.
            fontdir=Path(__file__).parent/'fonts'
            import shutil
            (directory/'fonts').mkdir(exist_ok=True)
            for font in fontdir.rglob('*.ttf'):
                shutil.copyfile(font,directory/'fonts'/font.name)
            head=f'color=c=black@0:s={width}x{height}:r={fps}:d={number(item.duration)},format=yuva444p,ass={ass}:fontsdir=fonts:alpha=1'
        a=item.adjustments
        if a.brightness or a.contrast!=1 or a.saturation!=1 or a.exposure or any(frame.values for frame in item.keyframes):
            head+=f",eq=brightness='{frame_expression(item,'brightness','t')}':contrast='{frame_expression(item,'contrast','t')}':saturation='{frame_expression(item,'saturation','t')}':gamma='pow(2,{frame_expression(item,'exposure','t')})':eval=frame"
        if a.temperature or a.tint or a.highlights or a.shadows:
            head+=f',colorbalance=rm={number(a.temperature*.3)}:bm={number(-a.temperature*.3)}:gm={number(a.tint*.3)}:rh={number(a.highlights*.3)}:gh={number(a.highlights*.3)}:bh={number(a.highlights*.3)}:rs={number(a.shadows*.3)}:gs={number(a.shadows*.3)}:bs={number(a.shadows*.3)}:pl=1'
        if a.sharpen: head+=f',unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount={number(a.sharpen)}'
        if a.blur: head+=f',gblur=sigma={number(a.blur*ratio)}'
        if a.grain: head+=f',noise=alls={number(a.grain*40)}:allf=t+u:all_seed=42'
        if a.vignette: head+=f',vignette=angle={number(a.vignette*math.pi/2)}'
        if item.mask.shape!='none':
            distance=('min(W/2-abs(X-W/2),H/2-abs(Y-H/2))' if item.mask.shape=='rectangle' else
                      '(1-sqrt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2)))*min(W,H)/2')
            feather=max(.01,item.mask.feather/100*min(width,height)/2)
            head+=f",geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(({distance})/{number(feather)},0,1)'"
        region=item.conceal
        if region.mode!='none':
            x=round(width*region.x/100); y=round(height*region.y/100)
            w=max(2,min(width-x,round(width*region.width/100)))
            h=max(2,min(height-y,round(height*region.height/100)))
            if region.mode=='cover':
                head+=f',drawbox=x={x}:y={y}:w={w}:h={h}:color={region.color}:t=fill'
            else:
                treatment=(f'boxblur=luma_radius={min(20,w//2-1,h//2-1)}:luma_power=3' if region.mode=='blur'
                           else f'scale={max(1,w//16)}:{max(1,h//16)}:flags=neighbor,scale={w}:{h}:flags=neighbor')
                head+=f',split=2[conceal-base{index}][conceal-cut{index}];[conceal-cut{index}]crop={w}:{h}:{x}:{y},{treatment}[conceal-region{index}];[conceal-base{index}][conceal-region{index}]overlay={x}:{y}:format=auto'
        transformed = bool(item.keyframes) or any(getattr(item.transform,key)!=value for key,value in {'x':0,'y':0,'scale':1,'rotation':0}.items()) or item.animation_in not in {'none','fade'} or item.animation_out not in {'none','fade'} or item.animation_loop not in {'none','fade'}
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
        # A clip can be both arriving and leaving (the middle of A->B->C), so
        # both ramps are multiplied rather than one chosen between them.
        blend=blends.get(item.id,{})
        ramps=[]
        for side in ('incoming','outgoing'):
            if blend.get(side):
                blend_start,length,identifier=blend[side]
                ramps.append(transition_alpha_expression(identifier,'T',length,side=='incoming',blend_start))
                if identifier in STATIC_BLUR:
                    # Static blur, but gated to the blend window. The layer
                    # exists for the clip's whole duration, so without this the
                    # blur would cover the entire clip instead of the seam.
                    radius=max(2,round(min(width,height)*.012))
                    head+=f",boxblur=luma_radius={radius}:luma_power=1:enable='between(t,{number(blend_start)},{number(blend_start+length)})'"
        if ramps: opacity=f"({opacity})*"+'*'.join(f'({r})' for r in ramps)
        if opacity!='1': head+=f",geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*({opacity})'"
        head+=f',setpts=PTS+{number(item.start)}/TB[layer{index}]'
        filters.append(head)
        new=f'v{index}'
        filters.append(f"[{visual}][layer{index}]overlay=0:0:format=auto:eof_action=pass:repeatlast=0:enable='gte(t,{number(item.start)})*lt(t,{number(item.start+item.duration)})'[{new}]")
        visual=new
    filters.append(f'[{visual}]format=yuv420p[video]')
    audio_labels=[]
    for index,item in enumerate(project.items):
        if item.kind=='text' or item.muted or item.freeze_at is not None or (tracks.get(item.track) and (tracks[item.track].muted or tracks[item.track].hidden)) or not assets[item.asset_id][2]['has_audio']: continue
        speed=item.speed; tempos=[]
        while speed<.5: tempos.append('atempo=0.5'); speed/=.5
        while speed>2: tempos.append('atempo=2'); speed/=2
        tempos.append(f'atempo={number(speed)}')
        volume=frame_expression(item,'volume','t')
        if tracks.get(item.track): volume=f'({volume})*{number(tracks[item.track].volume)}'
        if item.fade_in: volume=f'({volume})*clip(t/{number(item.fade_in)},0,1)'
        if item.fade_out: volume=f'({volume})*clip(({number(item.duration)}-t)/{number(item.fade_out)},0,1)'
        label=f'a{index}'
        if item.ducking:
            windows=[f'between(t,{number(max(0,voice.start-item.start-.12))},{number(min(item.duration,voice.start+voice.duration-item.start+.2))})'
                     for voice in project.items if voice.audio_role=='voiceover' and voice.asset_id and not voice.muted
                     and not (tracks.get(voice.track) and (tracks[voice.track].muted or tracks[voice.track].hidden))
                     and voice.start<item.start+item.duration and voice.start+voice.duration>item.start]
            if windows: volume=f'({volume})*if(gt({"+".join(windows)},0),.25,1)'
        reverse='areverse,' if item.reverse else ''
        filters.append(f"[{inputs[index]}:a]{reverse}asetpts=PTS-STARTPTS,{','.join(tempos)},aresample=48000,atrim=duration={number(item.duration)},volume='{volume}':eval=frame,adelay={round(item.start*48000)}S:all=1[{label}]")
        audio_labels.append(label)
    filters.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={number(duration)}[silence]')
    audio_labels.append('silence')
    filters.append(''.join(f'[{label}]' for label in audio_labels)+f'amix=inputs={len(audio_labels)}:duration=longest:normalize=0,alimiter=limit=0.95:level=false:latency=true,atrim=duration={number(duration)}[audio]')
    graph=directory/'filters.txt'; graph.write_text(';\n'.join(filters))
    command += ['-filter_complex_threads','2','-filter_complex_script',str(graph),'-map','[video]','-map','[audio]','-t',number(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r',str(fps),'-threads','2','-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1','-nostats',str(output)]
    return command


def render_project(project, assets, output, resolution, progress=None):
    if project.duration<=0: raise ValueError('Add at least one item before exporting.')
    issues=compatibility_issues(project)
    if issues:
        features=sorted({feature for issue in issues for feature in issue['features']})
        raise ValueError('The FFmpeg compatibility exporter does not support '+ '; '.join(features)+'. Use the shared browser exporter for these treatments, or remove them before retrying.')
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
