"""Validated, portable timeline documents; no executable filter text from clients."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Animation = Literal['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'pop', 'bounce', 'spin-left', 'spin-right', 'drop', 'float', 'drift', 'rise-fade', 'punch', 'blur-in', 'glitch', 'swing', 'tilt', 'push-in', 'whip', 'fade-zoom']

from .editor_transitions import (
    MAX_TRANSITION_DURATION, MIN_TRANSITION_OVERLAP, NO_TRANSITION, TransitionName,
    validate_project_transitions,
)

__all__ = ['Animation', 'EditorExport', 'Keyframe', 'Project', 'StrictModel',
           'TextStyle', 'TimelineItem', 'Transform', 'TransitionName']

class TextStyle(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    bold: bool = False
    italic: bool = False
    uppercase: bool = False
    align: Literal['left', 'center', 'right'] = 'center'
    stroke: float = Field(0, ge=0, le=12)
    stroke_color: str = Field('#000000', pattern=r'^#[0-9a-fA-F]{6}$')
    shadow: float = Field(0, ge=0, le=12)
    letter_spacing: float = Field(0, ge=-2, le=20)
    reveal: Literal['none', 'typewriter', 'karaoke'] = 'none'
    highlight: str = Field('#f9e54c', pattern=r'^#[0-9a-fA-F]{6}$')

class StrictModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')

class Transform(StrictModel):
    x: float = Field(0, ge=-200, le=200)
    y: float = Field(0, ge=-200, le=200)
    scale: float = Field(1, ge=.05, le=4)
    rotation: float = Field(0, ge=-3600, le=3600)
    opacity: float = Field(1, ge=0, le=1)

class Keyframe(Transform):
    time: float = Field(ge=0, le=600)
    volume: float = Field(1, ge=0, le=2)
    easing: Literal['linear','ease-in','ease-out','ease-in-out'] = 'linear'

class TimelineItem(StrictModel):
    id: str = Field(min_length=1, max_length=120)
    kind: Literal['video','audio','text']
    asset_id: str | None = Field(None, max_length=120)
    name: str = Field('', max_length=500)
    track: int = Field(0, ge=0, le=7)
    start: float = Field(0, ge=0, le=600)
    source_in: float = Field(0, ge=0, le=86400)
    duration: float = Field(gt=0, le=600)
    speed: float = Field(1, ge=.25, le=4)
    volume: float = Field(1, ge=0, le=2)
    muted: bool = False
    transform: Transform = Field(default_factory=Transform)
    keyframes: list[Keyframe] = Field(default_factory=list, max_length=120)
    animation_in: Animation = 'none'
    animation_out: Animation = 'none'
    animation_duration: float = Field(.5, ge=.01, le=30)
    # A transition blends this clip with the one before it on the same track.
    # Only the INCOMING side is stored: the outgoing half is derived from the
    # previous item, so the two can never be set to disagreeing values.
    transition_in: TransitionName = NO_TRANSITION
    transition_duration: float = Field(0.6, ge=MIN_TRANSITION_OVERLAP, le=MAX_TRANSITION_DURATION)
    fade_in: float = Field(0, ge=0, le=600)
    fade_out: float = Field(0, ge=0, le=600)
    fit: Literal['contain','cover'] = 'contain'
    text: str = Field('', max_length=5000)
    font_size: int = Field(64, ge=12, le=300)
    color: str = Field('#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    text_background: str = Field('transparent', pattern=r'^(transparent|#[0-9a-fA-F]{6})$')
    text_style: TextStyle = Field(default_factory=TextStyle)

    @model_validator(mode='after')
    def sane_item(self):
        if self.start + self.duration > 600.001:
            raise ValueError('The timeline must end within ten minutes.')
        if self.kind != 'text' and not self.asset_id:
            raise ValueError('Video and audio items need a media asset.')
        if self.kind == 'text' and self.asset_id is not None:
            raise ValueError('Text items do not use media assets.')
        # Last supplied keyframe at a timestamp wins, then sort deterministically.
        self.keyframes = sorted({frame.time: frame for frame in self.keyframes}.values(), key=lambda f: f.time)
        if any(frame.time > self.duration + .001 for frame in self.keyframes):
            raise ValueError('Keyframes must fall within their item duration.')
        return self

class Project(StrictModel):
    version: Literal[1] = 1
    width: int = 1080
    height: int = 1920
    fps: Literal[24,25,30,50,60] = 30
    background: str = Field('#000000', pattern=r'^#[0-9a-fA-F]{6}$')
    items: list[TimelineItem] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def supported_canvas(self):
        if (self.width, self.height) not in {(1080,1920),(1920,1080),(1080,1080)}:
            raise ValueError('Choose a portrait, landscape, or square canvas.')
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError('Timeline item IDs must be unique.')
        return self

    @model_validator(mode='after')
    def transitions_have_overlap(self):
        # A transition needs two clips sharing real screen time. Rejecting it
        # here means it is caught when the timeline is saved, and covers the
        # export route too — an impossible transition can never reach the
        # renderer and silently render as a hard cut.
        validate_project_transitions(self.items)
        return self

    @property
    def duration(self):
        return max((item.start + item.duration for item in self.items), default=0)

class EditorExport(StrictModel):
    project: Project
    resolution: Literal[480,720,1080] = 720
