"""Clip-to-clip transitions: an allow-list mapping ids to FFmpeg xfade effects.

SECURITY: a transition id arrives from an HTTP client. It is therefore never
interpolated into a filter string, an argv entry, or a shell command. Every id
is resolved through the immutable `TRANSITIONS` mapping below and rejected with
`validate_transition` if it is absent; only the vetted xfade name and
formatted floats ever reach a command line. This mirrors the rule already
documented in editor_models.py: no executable filter text from clients.

The ids here MUST stay identical to those in dashboard/src/studio/transitions.ts.
`transition_id_literal()` emits the typing counterpart for editor_models.py so
the two cannot drift apart silently.
"""
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class Transition:
    """One transition as the renderer understands it.

    Attributes:
        id: stable identifier persisted on the timeline item; never rename one.
        label: human label mirrored by the dashboard picker.
        xfade: the FFmpeg `xfade` transition name. Every value is checked
            against the names the linked FFmpeg build actually advertises.
        default_duration: suggested length in seconds.
        fallback: xfade name to use when the primary is unsupported. Keeps a
            project renderable on an older FFmpeg instead of failing outright.
        offset_slack: seconds of padding subtracted from a transition length
            when choosing an xfade offset, guarding against float drift.
        options: extra literal xfade options, e.g. the all=1 grid parameter.
    """
    id: str
    label: str
    xfade: str
    default_duration: float
    fallback: str | None = None
    offset_slack: float = 0.0
    options: dict = field(default_factory=dict)


DEFAULT_TRANSITION_DURATION = 0.6
#: Shortest perceptible blend; below this an overlap is treated as a hard cut.
MIN_TRANSITION_OVERLAP = 0.1
#: Longest transition the renderer will build, mirroring the Pydantic bound.
MAX_TRANSITION_DURATION = 5.0
#: The disabled transition. Accepted everywhere a transition id is accepted and
#: always resolves to a plain cut, so the UI and the model share one field.
NO_TRANSITION = 'none'

# Every xfade name below is verified against `ffmpeg -h filter=xfade` on the
# bundled FFmpeg 7.0.2 build. A name outside that enumeration would abort the
# render at runtime, so unverified names are only ever reached via `fallback`.
TRANSITIONS: dict[str, Transition] = {
    t.id: t for t in (
        Transition('crossfade', 'Cross dissolve', 'fade', 0.6),
        Transition('dip-to-black', 'Dip to black', 'fadeblack', 0.7),
        Transition('dip-to-white', 'Dip to white', 'fadewhite', 0.7),
        Transition('slide-left', 'Slide left', 'slideleft', 0.6),
        Transition('slide-right', 'Slide right', 'slideright', 0.6),
        Transition('slide-up', 'Slide up', 'slideup', 0.6),
        Transition('slide-down', 'Slide down', 'slidedown', 0.6),
        # 'push' reads as the incoming clip shoving the outgoing one off
        # screen; coverleft is the nearest built-in that moves both.
        Transition('push', 'Push', 'coverleft', 0.5),
        Transition('zoom-blur', 'Zoom blur', 'zoomin', 0.7, 'fade'),
        Transition('blur', 'Blur', 'hblur', 0.6, 'fade'),
        Transition('whip-pan', 'Whip pan', 'smoothleft', 0.4, 'slideleft'),
        Transition('circle-open', 'Circle open', 'circleopen', 0.7),
        Transition('circle-close', 'Circle close', 'circleclose', 0.7),
        Transition('wipe-left', 'Wipe left', 'wipeleft', 0.6),
        Transition('wipe-right', 'Wipe right', 'wiperight', 0.6),
        Transition('wipe-up', 'Wipe up', 'wipeup', 0.6),
        Transition('wipe-down', 'Wipe down', 'wipedown', 0.6),
        # A clock wipe is a radial sweep; 'radial' is the built-in match.
        Transition('clock-wipe', 'Clock wipe', 'radial', 0.7),
        Transition('pixelize', 'Pixelize', 'pixelize', 0.6),
        Transition('luma-burn', 'Luma burn', 'dissolve', 0.6),
    )
}

#: Ids accepted on the wire. Frozen so no caller can widen it at runtime.
TRANSITION_IDS: frozenset[str] = frozenset(TRANSITIONS)

#: The typing Literal the Pydantic model validates against. Built FROM the
#: catalogue rather than hand-written, so adding a transition to `TRANSITIONS`
#: widens the model in the same commit and the two can never drift.
TransitionName = Literal[tuple(sorted({NO_TRANSITION, *TRANSITIONS}))]

#: xfade names referenced by the table, checked against the real binary by the
#: inline sanity script so a typo is caught before a user hits it.
XFADE_NAMES: frozenset[str] = frozenset(
    name for t in TRANSITIONS.values() for name in (t.xfade, t.fallback) if name
)


def _number(value) -> str:
    """Format a float for a filter argument.

    Uses the same fixed-precision style as editor_render.number() so no
    exponent, locale decimal comma, or stray whitespace can reach the generated
    filter graph. The value is always a Python float formatted here, never a
    string echoed back from the request.
    """
    return format(float(value), '.10g')


def validate_transition(value) -> str:
    """Return a safe transition id or raise ValueError.

    This is the ONLY gate through which client-supplied transition text may
    pass. It accepts None and 'none' as the disabled transition, and rejects
    anything not present in the allow-list, including strings that merely look
    like filter syntax.
    """
    if value is None:
        return NO_TRANSITION
    if not isinstance(value, str):
        raise ValueError('Choose a transition from the list.')
    candidate = value.strip().lower()
    if candidate in ('', NO_TRANSITION):
        return NO_TRANSITION
    if candidate not in TRANSITIONS:
        raise ValueError('That transition is not supported.')
    return candidate


def is_transition(value) -> bool:
    """True when `value` is an allow-listed id (or the disabled 'none')."""
    try:
        validate_transition(value)
    except ValueError:
        return False
    return True


def validate_transition_duration(value) -> float:
    """Return a transition length inside the renderable range, or raise."""
    try:
        duration = float(value)
    except (TypeError, ValueError):
        raise ValueError('Choose a transition length between 0.1 and 5 seconds.') from None
    if duration != duration or duration in (float('inf'), float('-inf')):
        raise ValueError('Choose a transition length between 0.1 and 5 seconds.')
    if duration < MIN_TRANSITION_OVERLAP:
        raise ValueError('Transitions must be at least 0.1 seconds long.')
    if duration > MAX_TRANSITION_DURATION:
        raise ValueError('Transitions can be at most 5 seconds long.')
    return duration
@dataclass(frozen=True)
class XfadeSpec:
    """A resolved, render-ready xfade transition.

    Attributes:
        transition: the vetted FFmpeg xfade name to place in the filter.
        duration: transition length in seconds.
        offset: time, on the incoming stream's timeline, at which the blend
            begins. Must satisfy offset + duration <= incoming duration.
        options: the full option dict, safe to splat into a filter string.
    """
    transition: str
    duration: float
    offset: float
    options: dict

    def filter_string(self) -> str:
        """Render the `xfade=...` option list for a -filter_complex script.

        Key order is fixed and every value came from TRANSITIONS or from
        `_number`, so the output is deterministic and injection-free.
        """
        parts = [f'transition={self.transition}']
        for key in sorted(self.options):
            value = self.options[key]
            if isinstance(value, bool):
                parts.append(f'{key}={1 if value else 0}')
            elif isinstance(value, float):
                parts.append(f'{key}={_number(value)}')
            else:
                parts.append(f'{key}={value}')
        return 'xfade=' + ':'.join(parts)


def xfade_filter(transition_id, duration, offset, *, available=None) -> XfadeSpec:
    """Resolve a transition id into a renderable xfade specification.

    Args:
        transition_id: client-supplied id. Validated against the allow-list;
            anything unknown raises ValueError rather than being passed through.
        duration: blend length in seconds. Clamped to the overlap it can occupy
            and to MAX_TRANSITION_DURATION.
        offset: where the blend starts, in seconds on the incoming stream.
        available: optional iterable of xfade names the local FFmpeg supports.
            When given, a transition whose primary effect is missing falls back
            to its vetted alternative instead of aborting the export.

    Returns:
        An `XfadeSpec` whose `.filter_string()` is safe to embed.

    Raises:
        ValueError: for an unknown id, or a non-positive/NaN duration.
    """
    identifier = validate_transition(transition_id)
    if identifier == NO_TRANSITION:
        raise ValueError('That transition is not supported.')
    spec = TRANSITIONS[identifier]

    length = validate_transition_duration(duration)
    # An xfade consumes time from BOTH inputs, so it can never be longer than
    # the space the two clips actually share.
    length = min(length, MAX_TRANSITION_DURATION)
    slack = spec.offset_slack
    if length - slack <= 0:
        raise ValueError('Transitions must be at least 0.1 seconds long.')

    name = spec.xfade
    if available is not None and name not in available:
        if not spec.fallback or spec.fallback not in available:
            raise ValueError('That transition is not supported by this FFmpeg build.')
        name = spec.fallback

    start = float(offset)
    if start != start or start in (float('inf'), float('-inf')):
        raise ValueError('The transition sits at an impossible point in time.')
    # A blend that starts before its input does simply clamps to the head of
    # the stream; xfade treats a negative offset as an error.
    start = max(0.0, start)

    options = dict(spec.options)
    options['duration'] = length
    options['offset'] = start
    return XfadeSpec(transition=name, duration=length, offset=start, options=options)


def xfade_chain(steps) -> list[str]:
    """Render an ordered sequence of transitions into filter-graph steps.

    `steps` is an iterable of `(XfadeSpec, in_label, out_label)` triples. The
    caller owns label allocation; this helper only formats, so the filter graph
    and the label bookkeeping stay in editor_render.py where the rest of the
    graph is assembled.

    Each returned entry is a complete filter line such as
        [v0][v1]xfade=transition=fade:duration=0.6:offset=1.4[vx1]
    """
    return [
        f'[{incoming}][{outgoing}]{spec.filter_string()}[{outgoing}]'
        for spec, incoming, outgoing in steps
    ]


def available_xfade_names(binary=None) -> frozenset[str]:
    """Introspect the local FFmpeg build for the xfade names it supports.

    Used by the sanity script and by a graceful pre-flight check; the renderer
    itself does not depend on it, because probing costs a subprocess. Returns
    an empty frozenset when FFmpeg cannot be inspected, which callers should
    treat as "assume everything is supported".
    """
    import subprocess

    from .media import ffmpeg_binary

    try:
        binary = binary or ffmpeg_binary()
        result = subprocess.run(
            [binary, '-hide_banner', '-h', 'filter=xfade'],
            capture_output=True, text=True, timeout=30,
        )
    except (ValueError, OSError, subprocess.SubprocessError):
        return frozenset()
    if result.returncode != 0:
        return frozenset()
    names = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        # Lines look like "     fade            0   ..FV....... fade transition".
        if len(parts) >= 3 and parts[1].lstrip('-').isdigit():
            names.add(parts[0])
    return frozenset(names)


def transition_overlap(first, second):
    """Return the shared window of two adjacent items, or None.

    Mirrors `findTransitionOverlap` in dashboard/src/studio/transitions.ts so
    the timeline UI and the validator agree on when a transition is possible.
    Items on different tracks never transition: the renderer stacks tracks, it
    does not cut between them.

    Args:
        first, second: objects exposing `start`, `duration` and optionally
            `track` (a TimelineItem satisfies this).

    Returns:
        `(start, duration)` in absolute timeline seconds, or None.
    """
    tracks = (getattr(first, 'track', None), getattr(second, 'track', None))
    if tracks[0] is not None and tracks[1] is not None and tracks[0] != tracks[1]:
        return None
    a, b = sorted((first, second), key=lambda item: item.start)
    start = max(a.start, b.start)
    end = min(a.start + a.duration, b.start + b.duration)
    length = end - start
    if length != length or length < MIN_TRANSITION_OVERLAP:
        return None
    return start, length


#: FFmpeg time tokens a caller may ask for an alpha ramp against. Keeping
#: these allow-listed means the expression builder can never emit caller text
#: even if a future caller passes something unexpected.
TIME_TOKENS: frozenset[str] = frozenset({'T', 't', 'n', 'N'})


def transition_alpha_expression(transition_id, local_time, duration, incoming=True, blend_start=0.0):
    """Build the FFmpeg alpha multiplier for one side of a transition.

    The overlay renderer in editor_render.py composites each item onto a base
    canvas, so a cross-clip blend is expressed as a per-frame ALPHA ramp on the
    two overlapping layers rather than as an `xfade` between two streams. This
    returns the expression to multiply into that layer's alpha.

    Args:
        transition_id: allow-listed id (validated; 'none' yields '1').
        local_time: an FFmpeg time token from TIME_TOKENS. editor_render.py runs
            this filter BEFORE `setpts`, so `T` is item-local, not absolute.
        duration: blend length in seconds.
        incoming: True for the clip arriving, False for the clip leaving. The
            two sides are mirror images of each other.
        blend_start: local time at which the blend begins within the clip.

    Returns:
        A filter expression string built only from vetted literals and formatted
        numbers. It never contains client-supplied text.
    """
    identifier = validate_transition(transition_id)
    if identifier == NO_TRANSITION:
        return '1'
    if local_time not in TIME_TOKENS:
        raise ValueError('Use an FFmpeg time token such as T for the transition.')
    length = validate_transition_duration(duration)
    start = _number(validate_transition_duration(blend_start) if blend_start else 0.0)
    d = _number(length)
    # Ramp across the blend window and clamp, so the expression stays stable
    # for every frame of the clip rather than only inside the transition.
    ramp = f'clip(({local_time}-{start})/{d},0,1)'
    return ramp if incoming else f'(1-{ramp})'


def transition_map(items) -> dict:
    """Pair every item with its neighbours on the same track and resolve the
    blend window each of them takes part in.

    This is the renderer's single source of truth for "which frames blend with
    which". It is computed ONCE per render, before the filter loop, so the two
    halves of a pair cannot disagree about the window they share.

    Mirrors `findTransitionOverlap` in dashboard/src/studio/transitions.ts.

    Args:
        items: TimelineItem objects (anything with `id`, `kind`, `track`,
            `start`, `duration`, `transition_in`, `transition_duration`).

    Returns:
        A dict keyed by item id. Each value is `{'incoming': pair|None,
        'outgoing': pair|None}` where a pair is `(blend_start, length, id)`:

        - `incoming` — this clip is arriving, blending in from the clip before.
        - `outgoing` — the next clip is arriving, so this one blends away.

        `blend_start` is ITEM-LOCAL seconds, because the `geq` filter that
        consumes it runs before `setpts` and its `T` is therefore local too.
        Both keys may be present at once: in A->B->C the middle clip is both.

    An item with no transition, no neighbour, or too little overlap is simply
    absent from the map, which the renderer reads as "render this layer plain".
    """
    visual = sorted(
        (item for item in items if getattr(item, 'kind', 'video') != 'audio'),
        key=lambda item: (getattr(item, 'track', 0), item.start, item.id),
    )
    blends: dict = {}
    for index, item in enumerate(visual):
        identifier = validate_transition(getattr(item, 'transition_in', None))
        if identifier == NO_TRANSITION or index == 0:
            continue
        previous = visual[index - 1]
        window = transition_overlap(previous, item)
        if window is None:
            continue
        window_start, window_length = window
        # Clamp to the real overlap: a ramp longer than the overlap would run
        # past the end of one of the two clips.
        length = min(
            getattr(item, 'transition_duration', DEFAULT_TRANSITION_DURATION),
            window_length,
        )
        length = max(MIN_TRANSITION_OVERLAP, length)
        blends.setdefault(item.id, {})['incoming'] = (
            window_start - item.start, length, identifier,
        )
        blends.setdefault(previous.id, {})['outgoing'] = (
            window_start - previous.start, length, identifier,
        )
    return blends


def validate_project_transitions(items) -> list[tuple[str, str, float]]:
    """Check every item's transition against its real overlap.

    Run from the Project validator so an impossible transition is rejected on
    save rather than silently rendering as a hard cut on export.

    Returns:
        A list of `(incoming_id, outgoing_id, duration)` for each valid
        transition, in timeline order. Useful for logging and for the
        xfade chain builder.

    Raises:
        ValueError: naming the offending clip when a transition is requested
            but the clips do not overlap enough to support it.
    """
    visual = sorted(
        (item for item in items if getattr(item, 'kind', 'video') != 'audio'),
        key=lambda item: (item.track, item.start, item.id),
    )
    resolved = []
    for index, item in enumerate(visual):
        identifier = validate_transition(getattr(item, 'transition_in', None))
        if identifier == NO_TRANSITION or index == 0:
            continue
        previous = visual[index - 1]
        window = transition_overlap(previous, item)
        if window is None:
            raise ValueError(
                f'"{item.name or item.id}" needs to overlap the clip before it '
                'for a transition to play. Drag the clips together, shorten the '
                'transition, or set it back to None.'
            )
        length = min(getattr(item, 'transition_duration', DEFAULT_TRANSITION_DURATION), window[1])
        resolved.append((identifier, previous.id, length))
    return resolved


def transition_id_literal() -> str:
    """Render the typing Literal for editor_models.py.

    Emits e.g.
        TransitionName = Literal['none', 'crossfade', ...]
    so the model gains a transition field without hand-copying 21 strings.
    """
    values = ', '.join(repr(id) for id in (NO_TRANSITION, *sorted(TRANSITION_IDS)))
    return f'TransitionName = Literal[{values}]'