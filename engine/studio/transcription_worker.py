"""Invoked with a dedicated Python 3.11/3.12 runtime, never in the API process."""
import argparse
import json
import os


def recognize(path,model_name,cache):
    from faster_whisper import WhisperModel
    model=WhisperModel(model_name,device='cpu',compute_type='int8',local_files_only=True,
                       download_root=cache,cpu_threads=min(4,os.cpu_count() or 2))
    segments,info=model.transcribe(path,word_timestamps=True,vad_filter=True)
    text=[]; words=[]
    for segment in segments:
        text.append(segment.text.strip())
        for word in segment.words or []:
            if word.word.strip():
                words.append({'word':word.word.strip(),'start':round(max(0,word.start),3),
                              'end':round(max(word.start,word.end),3)})
    return {'text':' '.join(text),'words':words,'language':info.language}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',required=True)
    parser.add_argument('--model',required=True)
    parser.add_argument('--cache',required=True)
    args=parser.parse_args()
    print(json.dumps(recognize(args.input,args.model,args.cache)))
