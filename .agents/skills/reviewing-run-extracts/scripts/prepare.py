#!/usr/bin/env python3
"""Condense a run extract from scripts/export-turns.js so review agents can read all of it.

Writes, under the output directory (default: <extract-dir>/review):
  condensed/<channel>/<turnId>.txt  each turn's trace, with long results and arguments cut
  timeline/<channel>.md             every post, each status post annotated with its turn
  slices/<channel>-<i>of<n>/        one reader's share of a channel: timeline.md and turns.txt
  slices.json                       the slices, for fanning out readers
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

Turn = dict[str, Any]
Post = dict[str, Any]

TRACE_STEP_PATTERN = re.compile(r'^(\d+)\. \[\+([^\]]+)\] (.*)$')
TOOL_RESULT_PREFIX = '`'
STEP_CHARACTER_LIMITS: tuple[tuple[str, int], ...] = (
    ('assistant:', 6_000),
    ('called', 2_500),
    (TOOL_RESULT_PREFIX, 700),
)
OTHER_STEP_CHARACTER_LIMIT = 1_500
DEFAULT_SLICE_CHARACTERS = 700_000
# A slice's condensed traces filled about 62% of its reading on one extract, the timeline the rest; sizes are approximate.
TRACE_SHARE_OF_SLICE = 0.62
SMALLEST_SEPARATE_TAIL_SHARE = 0.2
FIRST_SLICE_START = '00:00:00'
LAST_SLICE_END = '23:59:59'
TURN_META_FIELDS = (
    'agent', 'channel', 'turnId', 'outcome', 'activation', 'depth', 'chain', 'turnDurationMs', 'promptTokens',
    'cachedPromptTokens', 'completionTokens', 'costUsd', 'windowEstimatedTokens', 'statusPostId', 'traceChars',
)


@dataclass(frozen=True)
class TraceStep:
    number: str
    offset: str
    head: str
    body: tuple[str, ...]

    def render_condensed(self) -> str:
        text = self.head + ('\n' + '\n'.join(self.body) if self.body else '')
        limit = next(
            (limit for prefix, limit in STEP_CHARACTER_LIMITS if self.head.startswith(prefix)),
            OTHER_STEP_CHARACTER_LIMIT,
        )
        is_cut_result = self.head.startswith(TOOL_RESULT_PREFIX) and len(text) > limit
        size_note = f' [result {len(text)} chars]' if is_cut_result else ''
        return f'{self.number}. [+{self.offset}] {truncate(text, limit)}{size_note}'


@dataclass(frozen=True)
class TimelineEntry:
    clock_time: str
    text: str


@dataclass(frozen=True)
class Slice:
    slice_id: str
    channel: str
    start: str
    end: str
    turns: tuple[Turn, ...]


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else f'{text[:limit]} …[+{len(text) - limit} chars]'


def clock_time_of_epoch_ms(epoch_ms: int, zone: tzinfo) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000, zone).strftime('%H:%M:%S')


def clock_time_of_iso(iso_timestamp: str, zone: tzinfo) -> str:
    moment = datetime.fromisoformat(iso_timestamp.replace('Z', '+00:00'))
    return moment.astimezone(zone).strftime('%H:%M:%S')


def turn_started_at(turn: Turn) -> str:
    """A turn with no status post (it took no action) is dated by its first post."""
    first_post = (turn.get('posts') or [{}])[0]
    return turn['statusPostCreatedAt'] or first_post.get('createdAt') or ''


def load_turns(extract_dir: Path) -> list[Turn]:
    with open(extract_dir / 'exported.jsonl') as rows:
        return [json.loads(row) for row in rows]


def parse_trace(trace_text: str) -> tuple[list[str], list[TraceStep]]:
    header: list[str] = []
    steps: list[TraceStep] = []
    for line in trace_text.split('\n'):
        match = TRACE_STEP_PATTERN.match(line)
        if match:
            number, offset, head = match.groups()
            steps.append(TraceStep(number, offset, head, ()))
        elif steps:
            last = steps[-1]
            steps[-1] = TraceStep(last.number, last.offset, last.head, (*last.body, line))
        else:
            header.append(line)
    return header, steps


def write_condensed_trace(turn: Turn, extract_dir: Path, condensed_dir: Path) -> None:
    header, steps = parse_trace((extract_dir / turn['tracePath']).read_text())
    meta = {field: turn.get(field) for field in TURN_META_FIELDS}
    destination = condensed_dir / turn['channel'] / f"{turn['turnId']}.txt"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        'META ' + json.dumps(meta) + '\n'
        + '\n'.join(header).rstrip() + '\n'
        + '\n'.join(step.render_condensed() for step in steps) + '\n'
    )


def describe_status_post_turn(turn: Turn, channel: str) -> str:
    duration_seconds = (turn.get('turnDurationMs') or 0) // 1000
    return (
        f"\nTURN {turn['turnId']} agent={turn['agent']} outcome={turn['outcome']} activation={turn['activation']}"
        f" depth={turn['depth']} chain={turn['chain']} dur={duration_seconds}s cost=${turn['costUsd']}"
        f" window≈{turn['windowEstimatedTokens']} prompt={turn['promptTokens']} cached={turn['cachedPromptTokens']}"
        f" → condensed/{channel}/{turn['turnId']}.txt"
    )


def build_timeline(
    channel: str, posts: list[Post], turns_by_status_post: dict[str, Turn], zone: tzinfo
) -> list[TimelineEntry]:
    entries: list[TimelineEntry] = []
    for post in sorted(posts, key=lambda post: post['create_at']):
        flags = [name for name, is_set in (('PINNED', post.get('is_pinned')), ('DELETED', post.get('delete_at'))) if is_set]
        if post.get('edit_at'):
            flags.append('edited ' + clock_time_of_epoch_ms(post['edit_at'], zone))
        if post.get('type'):
            flags.append('type=' + post['type'])
        heading = f"## [{clock_time_of_epoch_ms(post['create_at'], zone)}] {post.get('username') or post['user_id']} ({post['id']})"
        if flags:
            heading += f" [{', '.join(flags)}]"
        status_post_turn = turns_by_status_post.get(post['id'])
        if status_post_turn:
            heading += describe_status_post_turn(status_post_turn, channel)
        entries.append(TimelineEntry(clock_time_of_epoch_ms(post['create_at'], zone), heading + '\n' + post.get('message', '') + '\n'))
    return entries


def group_turns_by_reading_size(turns: list[Turn], condensed_dir: Path, slice_characters: int) -> list[list[Turn]]:
    groups: list[list[Turn]] = []
    current: list[Turn] = []
    current_characters = 0
    for turn in turns:
        current.append(turn)
        current_characters += (condensed_dir / turn['channel'] / f"{turn['turnId']}.txt").stat().st_size
        if current_characters > slice_characters * TRACE_SHARE_OF_SLICE:
            groups.append(current)
            current, current_characters = [], 0
    if current:
        if groups and current_characters < slice_characters * SMALLEST_SEPARATE_TAIL_SHARE:
            groups[-1].extend(current)
        else:
            groups.append(current)
    return groups


def split_channel_into_slices(
    channel: str, turns: list[Turn], condensed_dir: Path, slice_characters: int, zone: tzinfo
) -> list[Slice]:
    ordered = sorted(turns, key=turn_started_at)
    groups = group_turns_by_reading_size(ordered, condensed_dir, slice_characters)
    slices: list[Slice] = []
    for index, group in enumerate(groups):
        is_first, is_last = index == 0, index == len(groups) - 1
        start = FIRST_SLICE_START if is_first else clock_time_of_iso(turn_started_at(groups[index - 1][-1]), zone)
        end = LAST_SLICE_END if is_last else clock_time_of_iso(turn_started_at(group[-1]), zone)
        slices.append(Slice(f'{channel}-{index + 1}of{len(groups)}', channel, start, end, tuple(group)))
    return slices


def write_slice(reading_slice: Slice, timeline: list[TimelineEntry], slices_dir: Path) -> None:
    directory = slices_dir / reading_slice.slice_id
    directory.mkdir(parents=True, exist_ok=True)
    in_window = [entry.text for entry in timeline if reading_slice.start <= entry.clock_time <= reading_slice.end]
    (directory / 'timeline.md').write_text(
        f'# {reading_slice.channel} {reading_slice.start}–{reading_slice.end}\n\n' + '\n'.join(in_window)
    )
    turn_lines = [
        f"condensed/{reading_slice.channel}/{turn['turnId']}.txt {turn['agent']} {turn['outcome']} full={turn['tracePath']}"
        for turn in reading_slice.turns
    ]
    (directory / 'turns.txt').write_text('\n'.join(turn_lines) + '\n')


def prepare(extract_dir: Path, output_dir: Path, slice_characters: int, zone: tzinfo) -> list[Slice]:
    turns = load_turns(extract_dir)
    condensed_dir = output_dir / 'condensed'
    timeline_dir = output_dir / 'timeline'
    slices_dir = output_dir / 'slices'
    for turn in turns:
        write_condensed_trace(turn, extract_dir, condensed_dir)

    timeline_dir.mkdir(parents=True, exist_ok=True)
    turns_by_status_post = {turn['statusPostId']: turn for turn in turns if turn.get('statusPostId')}
    all_slices: list[Slice] = []
    for posts_file in sorted((extract_dir / 'posts').glob('*.json')):
        channel = posts_file.stem
        timeline = build_timeline(channel, json.loads(posts_file.read_text()), turns_by_status_post, zone)
        (timeline_dir / f'{channel}.md').write_text(f'# {channel} timeline, times in {zone}\n\n' + '\n'.join(entry.text for entry in timeline))
        channel_turns = [turn for turn in turns if turn['channel'] == channel]
        for reading_slice in split_channel_into_slices(channel, channel_turns, condensed_dir, slice_characters, zone):
            write_slice(reading_slice, timeline, slices_dir)
            all_slices.append(reading_slice)

    slice_index = [
        {'id': s.slice_id, 'channel': s.channel, 'start': s.start, 'end': s.end, 'turns': len(s.turns)}
        for s in all_slices
    ]
    (output_dir / 'slices.json').write_text(json.dumps(slice_index, indent=1))
    return all_slices


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('extract_dir', type=Path, help='the directory export-turns.js wrote')
    parser.add_argument('--out-dir', type=Path, help='where to write (default: <extract-dir>/review)')
    parser.add_argument('--slice-chars', type=int, default=DEFAULT_SLICE_CHARACTERS,
                        help='characters of reading per slice (default: %(default)s)')
    parser.add_argument('--timezone', required=True,
                        help="the operator's zone, which the traces' Started lines use, as an IANA name (e.g. Europe/Paris)")
    arguments = parser.parse_args()
    extract_dir = arguments.extract_dir.resolve()
    output_dir = (arguments.out_dir or extract_dir / 'review').resolve()
    zone = ZoneInfo(arguments.timezone)
    slices = prepare(extract_dir, output_dir, arguments.slice_chars, zone)
    turn_count = sum(len(s.turns) for s in slices)
    print(f'{turn_count} turns condensed, {len(slices)} slices → {output_dir}')


if __name__ == '__main__':
    main()
