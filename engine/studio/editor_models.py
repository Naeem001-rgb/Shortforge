"""Validated, portable timeline documents; no executable filter text from clients."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Animation = Literal['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'pop', 'bounce', 'spin-left', 'spin-right', 'drop', 'float', 'drift', 'rise-fade', 'punch', 'blur-in', 'glitch', 'swing', 'tilt', 'push-in', 'whip', 'fade-zoom', 'pulse', 'wobble', 'shake']

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
    case_style: Literal['none', 'upper', 'lower', 'title', 'sentence'] = 'none'
    line_height: float = Field(1, ge=.5, le=3)
    emphasis: Literal['none', 'pop', 'tilt', 'flash', 'shake'] = 'none'
    emphasis_scope: Literal['all', 'key'] = 'all'
    emphasis_words: Literal['none', 'all', 'first', 'last', 'longest', 'keyword'] = 'none'
    emphasis_keywords: list[str] = Field(default_factory=list, max_length=500)
    emphasis_case: Literal['none', 'upper', 'lower'] = 'none'
    emphasis_bold: bool = True
    emphasis_color: str = Field('#f9e54c', pattern=r'^#[0-9a-fA-F]{6}$')
    color_ramp: Literal['none', 'words'] = 'none'
    ramp_color: str = Field('#ff2d55', pattern=r'^#[0-9a-fA-F]{6}$')
    glow: float = Field(0, ge=0, le=100)
    glow_color: str = Field('#7c5cff', pattern=r'^#[0-9a-fA-F]{6}$')
    shadow_color: str = Field('#000000', pattern=r'^#[0-9a-fA-F]{6}$')
    shadow_opacity: float = Field(.5, ge=0, le=1)
    shadow_soft: float = Field(0, ge=0, le=100)
    box_padding: float = Field(0, ge=0, le=200)
    chip: Literal['none', 'emphasis'] = 'none'

class StrictModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')

class Transform(StrictModel):
    x: float = Field(0, ge=-200, le=200)
    y: float = Field(0, ge=-200, le=200)
    scale: float = Field(1, ge=.05, le=4)
    rotation: float = Field(0, ge=-3600, le=3600)
    opacity: float = Field(1, ge=0, le=1)

class Keyframe(Transform):
    preset: Literal['in', 'out', 'loop'] | None = None
    time: float = Field(ge=0, le=600)
    volume: float = Field(1, ge=0, le=2)
    easing: Literal['linear','ease-in','ease-out','ease-in-out','hold','spring','bounce','cubic-bezier'] = 'linear'
    bezier: tuple[float, float, float, float] | None = None
    values: dict[str, float] = Field(default_factory=dict, max_length=64)

    @model_validator(mode='after')
    def sane_curve(self):
        if self.bezier and not (0 <= self.bezier[0] <= 1 and 0 <= self.bezier[2] <= 1):
            raise ValueError('Bezier time controls must lie between zero and one.')
        # Property maps cannot introduce executable expressions or bypass bounds.
        limits = {'x':(-200,200), 'y':(-200,200), 'scale':(.05,4), 'rotation':(-3600,3600),
                  'opacity':(0,1), 'volume':(0,2), 'brightness':(-1,1), 'contrast':(0,3),
                  'saturation':(0,3), 'exposure':(-4,4), 'temperature':(-1,1), 'tint':(-1,1),
                  'highlights':(-1,1), 'shadows':(-1,1), 'vignette':(0,1), 'sharpen':(0,5),
                  'grain':(0,1), 'blur':(0,100)}
        for name, value in self.values.items():
            group, separator, field = name.partition('.')
            key = field if separator else group
            bounds = (0,99) if group == 'crop' and key in {'top','right','bottom','left'} else limits.get(key)
            valid_group = not separator or (group == 'adjustments' and key in Adjustments.model_fields) or (group == 'transform' and key in Transform.model_fields) or (group == 'crop' and key in {'top','right','bottom','left'})
            if not valid_group or bounds is None or not bounds[0] <= value <= bounds[1]:
                raise ValueError(f'Unsupported or out-of-range keyframe property: {name}')
        return self

class CaptionWord(StrictModel):
    word: str = Field(min_length=1, max_length=500)
    start: float = Field(ge=0, le=600)
    end: float = Field(ge=0, le=600)

    @model_validator(mode='after')
    def ordered(self):
        if self.end < self.start:
            raise ValueError('Caption word end must follow its start.')
        return self

class Crop(StrictModel):
    top: float = Field(0, ge=0, le=99)
    right: float = Field(0, ge=0, le=99)
    bottom: float = Field(0, ge=0, le=99)
    left: float = Field(0, ge=0, le=99)

    @model_validator(mode='after')
    def visible(self):
        if self.top + self.bottom >= 100 or self.left + self.right >= 100:
            raise ValueError('Crop must leave some image visible.')
        return self

class Adjustments(StrictModel):
    brightness: float = Field(0, ge=-1, le=1)
    contrast: float = Field(1, ge=0, le=3)
    saturation: float = Field(1, ge=0, le=3)
    exposure: float = Field(0, ge=-4, le=4)
    temperature: float = Field(0, ge=-1, le=1)
    tint: float = Field(0, ge=-1, le=1)
    highlights: float = Field(0, ge=-1, le=1)
    shadows: float = Field(0, ge=-1, le=1)
    vignette: float = Field(0, ge=0, le=1)
    sharpen: float = Field(0, ge=0, le=5)
    grain: float = Field(0, ge=0, le=1)
    blur: float = Field(0, ge=0, le=100)

class Mask(StrictModel):
    shape: Literal['none', 'circle', 'rectangle'] = 'none'
    feather: float = Field(0, ge=0, le=100)

class ChromaKey(StrictModel):
    enabled: bool = False
    color: str = Field('#00ff00', pattern=r'^#[0-9a-fA-F]{6}$')
    similarity: float = Field(.2, ge=0, le=1)

class Conceal(StrictModel):
    mode: Literal['none', 'blur', 'cover', 'mosaic'] = 'none'
    x: float = Field(5, ge=0, le=100)
    y: float = Field(60, ge=0, le=100)
    width: float = Field(90, gt=0, le=100)
    height: float = Field(18, gt=0, le=100)
    color: str = Field('#000000', pattern=r'^#[0-9a-fA-F]{6}$')

    @model_validator(mode='after')
    def inside_canvas(self):
        if self.x + self.width > 100.001 or self.y + self.height > 100.001:
            raise ValueError('Conceal region must fit inside the canvas.')
        return self

class EditorTrack(StrictModel):
    id: int = Field(ge=0, le=65535)
    name: str = Field('', max_length=500)
    kind: Literal['video', 'audio', 'text'] = 'video'
    locked: bool = False
    hidden: bool = False
    muted: bool = False
    volume: float = Field(1, ge=0, le=2)

class EditorMarker(StrictModel):
    id: str = Field(min_length=1, max_length=120)
    time: float = Field(ge=0, le=600)
    label: str = Field('', max_length=500)
    color: str | None = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')

class TimelineItem(StrictModel):
    id: str = Field(min_length=1, max_length=120)
    kind: Literal['video','audio','text']
    asset_id: str | None = Field(None, max_length=120)
    name: str = Field('', max_length=500)
    track: int = Field(0, ge=0, le=65535)
    start: float = Field(0, ge=0, le=600)
    source_in: float = Field(0, ge=0, le=86400)
    duration: float = Field(gt=0, le=600)
    speed: float = Field(1, ge=.1, le=10)
    volume: float = Field(1, ge=0, le=2)
    muted: bool = False
    transform: Transform = Field(default_factory=Transform)
    keyframes: list[Keyframe] = Field(default_factory=list, max_length=5000)
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
    caption_words: list[CaptionWord] = Field(default_factory=list, max_length=5000)
    caption_style: str = Field('', max_length=120)
    font_family: str = Field('DejaVu Sans', max_length=120, pattern=r'^[\w .-]+$')
    reverse: bool = False
    freeze_at: float | None = Field(None, ge=0, le=86400)
    flip_x: bool = False
    flip_y: bool = False
    crop: Crop = Field(default_factory=Crop)
    adjustments: Adjustments = Field(default_factory=Adjustments)
    animation_loop: Animation = 'none'
    animation_labels: dict[Literal['in','out','loop'], Animation] = Field(default_factory=dict)
    animation_base_keyframes: list[Keyframe] | None = Field(None, max_length=5000)
    group_id: str = Field('', max_length=120)
    blend_mode: Literal['normal','multiply','screen','overlay','lighten','darken'] = 'normal'
    mask: Mask = Field(default_factory=Mask)
    chroma_key: ChromaKey = Field(default_factory=ChromaKey)
    conceal: Conceal = Field(default_factory=Conceal)
    audio_role: Literal['original','voiceover','music','sfx'] = 'original'
    ducking: bool = False

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
        if self.animation_base_keyframes is not None:
            self.animation_base_keyframes = sorted({frame.time: frame for frame in self.animation_base_keyframes}.values(), key=lambda f: f.time)
            if any(frame.time > self.duration + .001 for frame in self.animation_base_keyframes):
                raise ValueError('Original animation keys must fall within their item duration.')
        if any(word.end > self.duration + .001 for word in self.caption_words):
            raise ValueError('Caption word times must fall within their item duration.')
        if any(a.start > b.start for a, b in zip(self.caption_words, self.caption_words[1:])):
            raise ValueError('Caption words must be in time order.')
        return self

class Project(StrictModel):
    version: Literal[1] = 1
    width: int = 1080
    height: int = 1920
    fps: Literal[24,25,30,50,60] = 30
    background: str = Field('#000000', pattern=r'^#[0-9a-fA-F]{6}$')
    items: list[TimelineItem] = Field(default_factory=list, max_length=5000)
    tracks: list[EditorTrack] = Field(default_factory=list, max_length=4096)
    markers: list[EditorMarker] = Field(default_factory=list, max_length=5000)
    script: str = Field('', max_length=100000)
    name: str = Field('', max_length=500)
    source_seeded: bool = False

    @model_validator(mode='after')
    def supported_canvas(self):
        if (self.width, self.height) not in {(1080,1920),(1920,1080),(1080,1080)}:
            raise ValueError('Choose a portrait, landscape, or square canvas.')
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError('Timeline item IDs must be unique.')
        if len({track.id for track in self.tracks}) != len(self.tracks):
            raise ValueError('Track IDs must be unique.')
        if len({marker.id for marker in self.markers}) != len(self.markers):
            raise ValueError('Marker IDs must be unique.')
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
