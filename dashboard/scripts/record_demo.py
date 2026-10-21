#!/usr/bin/env python3
"""Record only an explicitly selected dashboard X11 window at 60fps for one minute."""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


def capture_command(window_id, output, source, display):
    filters = ['pad=ceil(iw/2)*2:ceil(ih/2)*2']
    if source == 'mock':
        filters.append("drawtext=text='Demo rehearsal - mock telemetry':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.8:x=24:y=h-th-24")
    return ['ffmpeg', '-hide_banner', '-n', '-f', 'x11grab', '-framerate', '60', '-draw_mouse', '0',
            '-window_id', str(window_id), '-i', display, '-an', '-t', '60', '-vf', ','.join(filters),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-fps_mode', 'cfr', '-r', '60', '-movflags', '+faststart',
            '-metadata', 'comment=' + ('MOCK REHEARSAL: not evidence of kernel enforcement' if source == 'mock' else 'Live bridge capture; verify enforcement separately'), str(output)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--window-id', required=True, type=lambda value: int(value, 0), help='X11 window ID from xwininfo; never the root window')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source', required=True, choices=['mock', 'live'])
    parser.add_argument('--display', default=os.environ.get('DISPLAY', ':0'))
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if not 0 < args.window_id <= 0xFFFFFFFF or args.output.suffix.lower() != '.mp4':
        parser.error('Select a nonzero window ID and an .mp4 output')
    if args.output.exists():
        parser.error('Output already exists; choose a new filename')
    command = capture_command(args.window_id, args.output, args.source, args.display)
    if args.dry_run:
        print(json.dumps(command, indent=2))
        return
    for name in ['ffmpeg', 'ffprobe', 'xwininfo']:
        if not shutil.which(name):
            parser.error(f'{name} is required')
    info = subprocess.run(['xwininfo', '-id', str(args.window_id)], check=True, text=True, capture_output=True).stdout
    if 'SyscallGuard' not in info:
        parser.error('The selected window is not titled SyscallGuard; capture refused')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(command, check=True)
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                            '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
                            '-of', 'json', str(args.output)], check=True, text=True, capture_output=True)
    metadata = json.loads(probe.stdout)
    video = metadata['streams'][0]
    if video['r_frame_rate'] != '60/1' or int(video['nb_read_frames']) != 3600 or abs(float(metadata['format']['duration']) - 60) > 0.1:
        raise RuntimeError(f'Capture did not meet 60s/60fps requirements: {metadata}')
    args.output.with_suffix('.json').write_text(json.dumps({'source': args.source, 'capture': metadata}, indent=2) + '\n')
    print(f'Verified 60s / 60fps capture: {args.output}')


if __name__ == '__main__':
    main()
