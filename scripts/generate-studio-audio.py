"""Original procedural starter sounds. Source and generated audio dedicated CC0-1.0."""
from pathlib import Path
import subprocess, tempfile, wave
import numpy as np
ROOT=Path(__file__).resolve().parents[1]/'dashboard/public/audio'
ROOT.mkdir(parents=True,exist_ok=True)
FFMPEG=subprocess.check_output([str(ROOT.parents[2]/".venv/bin/python"),"-c","import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],text=True).strip()
RATE=48000
rng=np.random.default_rng(20261002)
def write(name,samples):
    peak=max(.001,float(np.max(np.abs(samples))))
    samples=np.tanh(samples/peak)*.5
    data=(np.column_stack((samples,samples*.97))*32767).astype('<i2').tobytes()
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        with wave.open(f.name,'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(data)
        subprocess.run([FFMPEG,'-v','error','-y','-i',f.name,'-c:a','libmp3lame','-b:a','160k',str(ROOT/(name+'.mp3'))],check=True)
def bed(name,chords,bpm):
    length=24;t=np.arange(RATE*length)/RATE;out=np.zeros_like(t);beat=60/bpm
    for n,notes in enumerate(chords*3):
        at=n*2;local=t-at;envelope=np.where((local>=0)&(local<4),np.minimum(1,np.maximum(0,local/.4))*np.exp(-np.maximum(0,local)/1.8),0)
        for midi in notes:
            f=440*2**((midi-69)/12);out+=(np.sin(2*np.pi*f*local)+.15*np.sin(4*np.pi*f*local))*envelope*.12
    for n in range(int(length/beat)):
        at=n*beat;local=t-at;mask=(local>=0)&(local<.12)
        out[mask]+=.08*np.sin(2*np.pi*(80*local[mask]-100*local[mask]**2))*np.exp(-local[mask]*35)
    out*=np.minimum(1,t/1.5)*np.minimum(1,(length-t)/2)
    write(name,out)
bed('after-hours',[(48,55,60,63),(44,51,56,60),(46,53,58,62),(43,50,55,58)],84)
bed('quiet-momentum',[(50,57,62,65),(48,55,60,64),(46,53,58,62),(45,52,57,60)],100)
bed('small-wonders',[(60,64,67),(57,60,64),(53,57,60),(55,59,62)],92)
for name,duration in [('soft-pop',.18),('gentle-ding',1.3),('whoosh',.7),('tap',.09),('low-impact',.8),('rising-chime',1.2)]:
    t=np.arange(int(RATE*duration))/RATE
    if name=='soft-pop':out=np.sin(2*np.pi*(500*t-950*t*t))*np.exp(-t*35)
    elif name=='gentle-ding':out=(np.sin(2*np.pi*880*t)+.35*np.sin(2*np.pi*1320*t))*np.exp(-t*4)
    elif name=='whoosh':out=rng.normal(0,.3,len(t))*np.sin(np.pi*t/duration)**2
    elif name=='tap':out=rng.normal(0,.3,len(t))*np.exp(-t*90)
    elif name=='low-impact':out=np.sin(2*np.pi*(72*t-24*t*t))*np.exp(-t*7)
    else:out=np.sin(2*np.pi*(400*t+250*t*t))*np.sin(np.pi*t/duration)**2*.5
    write(name,out)
print('Created 3 original music beds and 6 sound effects.')
