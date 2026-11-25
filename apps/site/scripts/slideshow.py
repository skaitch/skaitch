"""Assembles a demo video from still captures: each still gets a caption bar; stills cross-fade.

Usage: python3 apps/site/scripts/slideshow.py spec.json out.mp4
spec.json: {"size": [1600, 900], "clips": [{"image": "path", "duration": 2.0, "caption": "text",
             "pad": "white", "fade": 0.35}, ...]}
`fade` is the cross-fade into that clip (default 0.35 s; use a tiny value such as 0.04 for an orbit).
"""
import json, os, subprocess, sys, tempfile

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'

spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
W, H = spec.get('size', [1600, 900])
clips = spec['clips']
capdir = tempfile.mkdtemp(prefix='captions-')
inputs, filters = [], []
for i, c in enumerate(clips):
    inputs += ['-loop', '1', '-t', f"{c['duration']:.2f}", '-i', c['image']]
    cf = os.path.join(capdir, f'{i:03d}.txt')
    open(cf, 'w').write(c.get('caption', ''))
    bar = int(H * 0.075)
    caption = (f'drawbox=x=0:y=ih-{bar}:w=iw:h={bar}:color=0x0D2B4A@0.92:t=fill,'
               f"drawtext=fontfile={FONT}:textfile={cf}:fontcolor=white:fontsize={int(bar * 0.43)}:x={int(bar * 0.5)}:y=h-{int(bar * 0.7)},"
               f'drawbox=x=0:y=ih-{bar}:w=10:h={bar}:color=0xFFB000:t=fill,') if c.get('caption') else ''
    filters.append(
        f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={c.get('pad', 'white')},"
        f'{caption}setsar=1,fps=30,format=yuv420p[v{i}]')
prev, offset = 'v0', clips[0]['duration']
for i in range(1, len(clips)):
    fade = clips[i].get('fade', 0.35)
    offset -= fade
    filters.append(f'[{prev}][v{i}]xfade=transition=fade:duration={fade}:offset={offset:.3f}[x{i}]')
    prev = f'x{i}'
    offset += clips[i]['duration']
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(filters), '-map', f'[{prev}]',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out],
               check=True)
print('written', out, f'{offset:.1f}s')
