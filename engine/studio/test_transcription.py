"""Timestamp plumbing and an explicitly enabled local recognizer smoke test."""
import os
import shutil
import subprocess
from unittest.mock import patch

import pytest

from engine.core import db
from engine.studio.transcription import transcribe_asset, transcription_job


def test_text_without_word_timing_is_not_invented(tmp_path):
    with patch.object(db,'DATA_DIR',tmp_path), patch('engine.studio.transcription.runtime_python',return_value=tmp_path/'not-installed'), patch('engine.core.media.transcribe_file',return_value={'text':'spoken words','words':[]}):
        with pytest.raises(ValueError,match='without word timestamps'):
            transcribe_asset(tmp_path/'recording.wav')


def test_selected_asset_job_preserves_actual_timestamps(tmp_path):
    actual={'text':'First pause second','words':[{'word':'First','start':.24,'end':.59},{'word':'pause','start':1.16,'end':1.49},{'word':'second','start':2.38,'end':2.86}]}
    with patch.object(db,'DATA_DIR',tmp_path):
        with db.connect() as connection:
            connection.execute("INSERT INTO clips (id,title,license_status,created_at) VALUES ('clip','Recording','unknown',?)",(db.now(),))
        job=db.new_job('editor_transcribe','clip')
        with patch('engine.studio.transcription.runtime_python',return_value=tmp_path/'not-installed'), patch('engine.studio.editor_media.get_editor_asset',return_value=({},tmp_path/'recording.wav',{'has_audio':True})), patch('engine.core.media.transcribe_file',return_value=actual):
            transcription_job(job['id'],'clip','selected-recording',None)
        result=db.get_job(job['id'])
        assert result['status']=='completed',result
        assert result['result']['asset_id']=='selected-recording'
        assert result['result']['words']==actual['words']
        assert result['result']['estimated'] is False
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) FROM transcripts').fetchone()[0]==0


@pytest.mark.skipif(os.environ.get('SHORTFORGE_TEST_TRANSCRIPTION')!='1',reason='Real local model inference is opt-in; tests never download models')
def test_real_local_recognition_has_uneven_word_timestamps(tmp_path):
    speak=shutil.which('espeak-ng') or shutil.which('espeak')
    assert speak,'Install a local speech fixture generator to run this test'
    recording=tmp_path/'labeled-synthetic-speech.wav'
    subprocess.run([speak,'-s','135','-w',str(recording),'The quick brown fox jumps over the lazy dog. This recording tests real local word timestamps.'],check=True)
    result=transcribe_asset(recording)
    assert len(result['words'])>=8,result
    assert all(0<=w['start']<w['end'] for w in result['words'])
    assert len({round(w['end']-w['start'],2) for w in result['words']})>3
    assert result['estimated'] is False
