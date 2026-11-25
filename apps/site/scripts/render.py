"""Turns skAItch 3D captures into photorealistic renders with an image model.

Usage: python3 apps/site/scripts/render.py <capture.jpg> <out.png> [view hint]

The key is read from apps/site/.env.render.local (gitignored), which holds one of:
  FAL_KEY=...          (default model: fal-ai/flux-pro/kontext, override with FAL_MODEL)
  GEMINI_API_KEY=...   (default model: gemini-2.5-flash-image, override with GEMINI_IMAGE_MODEL)
  OPENAI_API_KEY=...   (model gpt-image-1, override with OPENAI_IMAGE_MODEL)
The capture goes to the provider as the reference image; the prompt asks to keep its geometry.
"""
import base64, json, os, sys, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(HERE, '..', '.env.render.local')

PROMPT = (
    'Turn this 3D model view of a single-storey house into a photorealistic architectural photograph. '
    'Keep exactly the same camera position, perspective and framing, the same building footprint, wall heights, '
    'gable roof shape and pitch, and the same number, positions and proportions of windows and doors. '
    'Materials: warm off-white lime render on the walls, terracotta clay roof tiles, anthracite aluminium window '
    'frames with clear glass, light stone window sills, a solid oak front door. '
    'Surroundings: a mown lawn, a gravel path to the front door, a few low shrubs, a calm residential setting. '
    'Soft natural daylight, light clouds, realistic shadows. No text, no grid, no dimension lines, no people.'
)


def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return {**env, **{k: v for k, v in os.environ.items() if k in ('FAL_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY')}}


def fal(key, model, image, prompt):
    # FLUX.1 Kontext edits from a reference image; the capture travels as a data URI.
    body = {'prompt': prompt, 'image_url': 'data:image/jpeg;base64,' + base64.b64encode(image).decode(),
            'output_format': 'png', 'num_images': 1}
    req = urllib.request.Request(f'https://fal.run/{model}', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Key {key}'})
    res = json.load(urllib.request.urlopen(req, timeout=300))
    url = res['images'][0]['url']
    if url.startswith('data:'):
        return base64.b64decode(url.split(',', 1)[1])
    return urllib.request.urlopen(url, timeout=120).read()


def gemini(key, model, image, prompt):
    body = {'contents': [{'parts': [
        {'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(image).decode()}},
        {'text': prompt},
    ]}]}
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    res = json.load(urllib.request.urlopen(req, timeout=180))
    for part in res['candidates'][0]['content']['parts']:
        data = part.get('inline_data') or part.get('inlineData')
        if data:
            return base64.b64decode(data['data'])
    raise RuntimeError('No image in the response: ' + json.dumps(res)[:400])


def openai(key, model, image, prompt):
    boundary = uuid.uuid4().hex
    fields = [('model', model), ('prompt', prompt), ('size', '1536x1024'), ('quality', 'high')]
    body = b''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields)
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="view.jpg"\r\n'
             'Content-Type: image/jpeg\r\n\r\n').encode() + image + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request('https://api.openai.com/v1/images/edits', data=body,
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    res = json.load(urllib.request.urlopen(req, timeout=300))
    return base64.b64decode(res['data'][0]['b64_json'])


def main():
    src, out = sys.argv[1], sys.argv[2]
    hint = sys.argv[3] if len(sys.argv) > 3 else ''
    env = load_env()
    image = open(src, 'rb').read()
    prompt = PROMPT + (' ' + hint if hint else '')
    if env.get('FAL_KEY'):
        png = fal(env['FAL_KEY'], env.get('FAL_MODEL', 'fal-ai/flux-pro/kontext'), image, prompt)
    elif env.get('GEMINI_API_KEY'):
        png = gemini(env['GEMINI_API_KEY'], env.get('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'), image, prompt)
    elif env.get('OPENAI_API_KEY'):
        png = openai(env['OPENAI_API_KEY'], env.get('OPENAI_IMAGE_MODEL', 'gpt-image-1'), image, prompt)
    else:
        sys.exit(f'No FAL_KEY, GEMINI_API_KEY or OPENAI_API_KEY in {os.path.normpath(ENV_FILE)}')
    open(out, 'wb').write(png)
    print('written', out, len(png), 'bytes')


if __name__ == '__main__':
    main()
